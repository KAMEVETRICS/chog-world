import { createHash } from "node:crypto";
import fs from "node:fs";
import type pg from "pg";

const MIGRATIONS_DIR = new URL("../../migrations/", import.meta.url);
// Arbitrary constant key so concurrent starts apply migrations one at a time.
const MIGRATION_LOCK_KEY = 48_210_217;

export interface MigrationReport {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Applies pending SQL migrations in name order, all in one transaction under an advisory lock.
 * A migration that was already applied must be unchanged; an edited file stops startup.
 */
export async function migrate(pool: pg.Pool): Promise<MigrationReport> {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query("CREATE TABLE IF NOT EXISTS cult_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const { rows } = await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM cult_migrations");
    const done = new Map(rows.map((row) => [row.name, row.checksum]));
    const applied: string[] = [];
    const skipped: string[] = [];
    for (const name of files) {
      const sql = fs.readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const previous = done.get(name);
      if (previous !== undefined) {
        if (previous !== checksum) throw new Error(`Migration ${name} changed after it was applied; add a new migration instead.`);
        skipped.push(name);
        continue;
      }
      await client.query(sql);
      await client.query("INSERT INTO cult_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
      applied.push(name);
    }
    await client.query("COMMIT");
    return { applied, skipped };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
