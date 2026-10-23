// Records the JSON-RPC exchanges behind test/chain/recorded.test.ts from Monad testnet. Read-only: it
// verifies the testnet adapter's manifest and resolves the awakened test token of the public ownership
// proof (agent 2374: minted, awakened, then transferred). Nothing is signed or sent.
//
// The finalized head is pinned to block 72501000 so the recording stays small and repeatable: requests
// for "finalized" are forwarded as that block number and recorded under "finalized".
//
//   npm.cmd run record:rpc
import fs from "node:fs";
import http from "node:http";
import { HttpJsonRpc } from "../src/chain/rpc.ts";
import { parseManifest, verifyManifest } from "../src/chain/manifest.ts";
import { LiveChainReader } from "../src/chain/liveChainReader.ts";
import { MemoryProjectionStore } from "../src/chain/projection.ts";
import { codeHash } from "../src/chain/evm.ts";

const upstream = process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz";
const out = new URL("../test/chain/recorded/monad-testnet.json", import.meta.url);
const PINNED_FINALIZED = 72501000n;
const deployment = JSON.parse(fs.readFileSync(new URL("../../deployments/1792445134988-monad-testnet.json", import.meta.url), "utf8"));
const proof = JSON.parse(fs.readFileSync(new URL("../../deployments/1792447471099-monad-testnet-ownership-proof.json", import.meta.url), "utf8"));
const adapterRecord = deployment.deployments.ChogAdapter;
const hex = (value) => `0x${value.toString(16)}`;

const exchanges = [];
const keys = new Set();
const proxy = http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const forwarded = payload.method === "eth_getBlockByNumber" && payload.params[0] === "finalized"
      ? { ...payload, params: [hex(PINNED_FINALIZED), ...payload.params.slice(1)] } : payload;
    const reply = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forwarded) });
    const text = await reply.text();
    const key = `${payload.method} ${JSON.stringify(payload.params)}`;
    if (!keys.has(key)) {
      keys.add(key);
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      exchanges.push({ request: { method: payload.method, params: payload.params }, status: reply.status, body });
    }
    response.writeHead(reply.status, { "content-type": "application/json" }).end(text);
  });
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const rpc = new HttpJsonRpc({ url: `http://127.0.0.1:${proxy.address().port}`, timeoutMs: 15_000 });

try {
  // 1. The manifest of the real testnet deployment, built from its record and checked read-only.
  const activation = await rpc.request("eth_getBlockByNumber", [hex(BigInt(adapterRecord.blockNumber)), false]);
  const code = await rpc.request("eth_getCode", [adapterRecord.address.toLowerCase(), { blockHash: activation.hash, requireCanonical: true }]);
  const manifest = parseManifest({
    environment: "monad-testnet", chainId: 10143, registry: deployment.registry, adapter: adapterRecord.address, collection: deployment.collection,
    activationBlock: String(adapterRecord.blockNumber), activationBlockHash: activation.hash,
    receipts: { adapterDeployment: adapterRecord.transactionHash }, runtimeCodeHashes: { adapter: codeHash(code) },
  });
  const verified = await verifyManifest(rpc, manifest);

  // 2. Resolve the proof token. The projection starts at block 72500900, just before the token's mint
  //    (72500939), rather than at the adapter's deployment, to keep the recording to one log request.
  const start = await rpc.request("eth_getBlockByNumber", [hex(72500900n), false]);
  const live = { ...verified.deployment, activation: { number: 72500900n, hash: start.hash } };
  const reader = new LiveChainReader({ rpc, store: new MemoryProjectionStore(), deployment: live, maxAgeMs: 600_000 });
  const identity = { chainId: 10143, registry: live.registry, adapter: live.adapter, collection: live.collection, tokenId: proof.tokenId, agentId: proof.checks.afterAwaken.agentId };
  const observations = {
    proofToken: await reader.resolveAgent(identity),
    unknownAgent: await reader.resolveAgent({ ...identity, agentId: "999999999" }),
  };

  // 3. A chunk larger than the provider allows: the provider's HTTP 413 must become `unavailable`.
  const early = await rpc.request("eth_getBlockByNumber", [hex(72500268n), false]);
  const wideReader = new LiveChainReader({ rpc, store: new MemoryProjectionStore(), deployment: { ...live, activation: { number: 72500268n, hash: early.hash } }, chunkBlocks: 1000 });
  observations.tooWide = await wideReader.resolveAgent(identity);

  const recording = {
    source: new URL(upstream).hostname, recordedAt: new Date().toISOString(), chainId: 10143,
    pinnedFinalized: PINNED_FINALIZED.toString(),
    scenario: {
      manifest,
      projectionStart: { number: "72500900", hash: start.hash },
      wideStart: { number: "72500268", hash: early.hash },
      proof: { tokenId: proof.tokenId, agentId: proof.checks.afterAwaken.agentId, owner: proof.owner.toLowerCase(), recipient: proof.recipient.toLowerCase(), mintBlock: proof.transactions.mint.blockNumber, transferBlock: proof.transactions.transfer.blockNumber },
    },
    observedWhenRecorded: JSON.parse(JSON.stringify(observations, (_key, value) => (typeof value === "bigint" ? value.toString() : value))),
    exchanges,
  };
  fs.mkdirSync(new URL(".", out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(recording, null, 2)}\n`);
  console.log(`Recorded ${exchanges.length} exchanges to ${out.pathname}`);
  console.log(JSON.stringify(recording.observedWhenRecorded, null, 2));
} finally {
  rpc.close();
  proxy.close();
}
