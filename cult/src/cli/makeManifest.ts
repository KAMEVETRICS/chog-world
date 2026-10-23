// Writes the verified deployment manifest that Cult (and City) trust, from a root deployment record.
// Read-only: it reads the receipt, block and code, then runs the same checks as the live server.
//
//   npm.cmd run manifest -- <deployment record> <manifest to write>
import fs from "node:fs";
import { manifestFromDeployment, verifyManifest } from "../chain/manifest.js";
import { HttpJsonRpc } from "../chain/rpc.js";

const [recordPath, outPath] = process.argv.slice(2);
try {
  if (!recordPath || !outPath) throw new Error("Usage: npm.cmd run manifest -- <deployment record> <manifest to write>");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8")) as { chainId?: unknown };
  const networks: Record<string, { environment: string; url: string }> = {
    143: { environment: "monad-mainnet", url: process.env.MONAD_MAINNET_RPC_URL || "https://rpc.monad.xyz" },
    10143: { environment: "monad-testnet", url: process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz" },
  };
  const network = networks[String(record.chainId)];
  if (!network) throw new Error(`The record is for chain ${String(record.chainId)}; expected 143 or 10143.`);
  const rpc = new HttpJsonRpc({ url: network.url, timeoutMs: 15_000 });
  try {
    const manifest = await manifestFromDeployment(rpc, record, network.environment);
    const verified = await verifyManifest(rpc, manifest);
    if (fs.existsSync(outPath)) throw new Error(`${outPath} already exists; not overwriting it.`);
    fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Verified at block ${verified.verifiedAt.number} on ${rpc.host}; wrote ${outPath}.`);
  } finally {
    rpc.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
