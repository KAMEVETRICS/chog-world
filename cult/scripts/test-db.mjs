// Runs the PostgreSQL tests against the local test container (docker-compose.test.yml) unless
// CULT_TEST_DATABASE_URL points elsewhere. Start it first with: npm.cmd run db:up
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = { ...process.env, CULT_TEST_DATABASE_URL: process.env.CULT_TEST_DATABASE_URL ?? "postgres://cult:cult-local-test@127.0.0.1:55432/cult_test" };
// Database tests share a database-wide migration lock. Run files serially so
// throwaway schemas do not queue behind one another and exhaust test timeouts.
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitest, "run", "test/db", "--testTimeout=20000", "--no-file-parallelism"], { stdio: "inherit", env });
process.exitCode = result.status ?? 1;
