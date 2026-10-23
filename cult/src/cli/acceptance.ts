// npm.cmd run demo:acceptance — needs CULT_DATABASE_URL (the local test database works).
import { runAcceptance } from "../demo/acceptance.js";

const url = process.env.CULT_DATABASE_URL;
if (!url) {
  console.error("Set CULT_DATABASE_URL, for example postgres://cult:cult-local-test@127.0.0.1:55432/cult_test (npm.cmd run db:up).");
  process.exitCode = 1;
} else {
  console.log("Chog Cult acceptance demo: two viewers, real API, Postgres scheduler, SIWE logins, live City reader.\n");
  const checks = await runAcceptance(url, (line) => console.log(line));
  const failed = checks.filter((entry) => !entry.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} acceptance checks passed.`);
  process.exitCode = failed.length ? 1 : 0;
}
