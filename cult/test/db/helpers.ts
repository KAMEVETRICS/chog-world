import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll } from "vitest";
import { migrate } from "../../src/db/migrate.js";

export const DATABASE_URL = process.env.CULT_TEST_DATABASE_URL;

const admin = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const pools: pg.Pool[] = [];
const schemas: string[] = [];

afterAll(async () => {
  await Promise.all(pools.map((pool) => pool.end()));
  for (const schema of schemas) await admin!.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin?.end();
});

/** A pool whose connections use their own throwaway schema, so tests never share state. */
export function poolFor(schema: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6, options: `-c search_path=${schema}` });
  pools.push(pool);
  return pool;
}

export async function freshSchema({ migrated = true } = {}): Promise<{ schema: string; pool: pg.Pool }> {
  if (!admin) throw new Error("CULT_TEST_DATABASE_URL is not set.");
  const schema = `cult_t_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  schemas.push(schema);
  const pool = poolFor(schema);
  if (migrated) await migrate(pool);
  return { schema, pool };
}
