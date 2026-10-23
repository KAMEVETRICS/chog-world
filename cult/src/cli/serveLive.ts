// Public Cult server for Monad mainnet (chain 143). Refuses fixture settings, needs a verified deployment
// manifest and a roster, and serves behind a reverse proxy at CULT_ORIGIN. See RUNBOOK.md.
import { liveConfigFromEnv } from "../live/config.js";
import { startLive } from "../live/start.js";

try {
  const server = await startLive(liveConfigFromEnv(process.env));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void server.close(); });
} catch (error) {
  console.error(`Live Cult did not start: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
