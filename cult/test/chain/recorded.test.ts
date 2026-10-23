// Replays JSON-RPC responses recorded from Monad testnet (scripts/record-rpc.mjs) through the real HTTP
// transport. The scenario is the public ownership proof: TestChog 1792447321178 was minted (block
// 72500939), awakened as agent 2374 (72500951) and transferred to a second wallet (72500966).
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { LiveChainReader, type LiveDeployment } from "../../src/chain/liveChainReader.js";
import { manifestFromDeployment, parseManifest, verifyManifest } from "../../src/chain/manifest.js";
import { MemoryProjectionStore } from "../../src/chain/projection.js";
import { HttpJsonRpc } from "../../src/chain/rpc.js";
import type { AgentIdentity } from "../../src/shared/identity.js";
import { RpcReplayServer, type RecordedExchange } from "./rpcReplay.js";

interface Recording {
  readonly pinnedFinalized: string;
  readonly scenario: {
    readonly manifest: unknown;
    readonly projectionStart: { number: string; hash: string };
    readonly wideStart: { number: string; hash: string };
    readonly proof: { tokenId: string; agentId: string; owner: string; recipient: string };
  };
  readonly exchanges: readonly RecordedExchange[];
}

const recording = JSON.parse(fs.readFileSync(new URL("./recorded/monad-testnet.json", import.meta.url), "utf8")) as Recording;
const { scenario } = recording;
const manifest = parseManifest(scenario.manifest);
const NOW = 1_800_000_000_000;

const open: { server: RpcReplayServer; rpc: HttpJsonRpc }[] = [];
afterEach(async () => {
  for (const { server, rpc } of open.splice(0)) { rpc.close(); await server.stop(); }
});

async function replay() {
  const server = new RpcReplayServer(recording.exchanges);
  const rpc = new HttpJsonRpc({ url: await server.start(), timeoutMs: 2_000 });
  open.push({ server, rpc });
  return { server, rpc };
}

function deployment(start = scenario.projectionStart): LiveDeployment {
  return { chainId: 10143, registry: manifest.registry, adapter: manifest.adapter, collection: manifest.collection, activation: { number: BigInt(start.number), hash: start.hash } };
}

function identity(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  return { chainId: 10143, registry: manifest.registry, adapter: manifest.adapter, collection: manifest.collection, tokenId: scenario.proof.tokenId, agentId: scenario.proof.agentId, ...overrides };
}

function reader(rpc: HttpJsonRpc, options: { start?: { number: string; hash: string }; chunkBlocks?: number; errors?: unknown[] } = {}) {
  return new LiveChainReader({
    rpc, store: new MemoryProjectionStore(), deployment: deployment(options.start), now: () => NOW, maxAgeMs: 60_000,
    ...(options.chunkBlocks ? { chunkBlocks: options.chunkBlocks } : {}),
    onError: (error) => options.errors?.push(error),
  });
}

describe("recorded Monad testnet responses", () => {
  it("verifies the real testnet deployment manifest", async () => {
    const { server, rpc } = await replay();
    const verified = await verifyManifest(rpc, manifest);
    expect(verified.deployment).toEqual({
      chainId: 10143, registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e", adapter: "0x095ffc29b9b7384763aac703a627bf8a2d6c7869",
      collection: "0x9c716801d68b5bdadf7979d37a382a72fdba1abe", activation: { number: 72493203n, hash: manifest.activationBlockHash },
    });
    expect(verified.verifiedAt.number).toBe(BigInt(recording.pinnedFinalized));
    expect(server.misses).toEqual([]);
  });

  it("builds the same manifest from the testnet deployment record, and refuses records that are not confirmed", async () => {
    const { server, rpc } = await replay();
    // deployments/1792445134988-monad-testnet.json in the repository root
    const record = { chainId: 10143, deployments: { ChogAdapter: {
      address: "0x095FFc29B9b7384763aac703a627Bf8A2D6c7869", transactionHash: "0xe2a6902c0698d157b48033cfa645666fc02ebe64a5b5743c0ccb2afb52459683",
      status: "confirmed", blockNumber: 72493203, constructorArgs: ["0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE", "0x8004A818BFB912233c491871b3d84c89A494BD9e"],
    } } };
    expect(await manifestFromDeployment(rpc, record, "monad-testnet")).toEqual(manifest);
    const pending = { deployments: { ChogAdapter: { ...record.deployments.ChogAdapter, status: "pending" } } };
    await expect(manifestFromDeployment(rpc, pending, "monad-testnet")).rejects.toThrow(/prepared or pending records are not deployments/);
    expect(server.misses).toEqual([]);
  });

  it("refuses a manifest whose chain, activation block or adapter code does not match the chain", async () => {
    const { rpc } = await replay();
    await expect(verifyManifest(rpc, { ...manifest, chainId: 143 })).rejects.toThrow(/serves chain 10143, the manifest is for chain 143/);
    await expect(verifyManifest(rpc, { ...manifest, activationBlockHash: `0x${"11".repeat(32)}` })).rejects.toThrow(/block 72493203 has hash/);
    await expect(verifyManifest(rpc, { ...manifest, runtimeCodeHashes: { adapter: `0x${"22".repeat(32)}` } })).rejects.toThrow(/runtime code hash/);
  });

  it("resolves the transferred proof token to its buyer, with the mint and the transfer counted in the epoch", async () => {
    const { server, rpc } = await replay();
    const observation = await reader(rpc).resolveAgent(identity());
    expect(observation).toEqual({
      kind: "controlled", controller: scenario.proof.recipient, ownershipEpoch: "3",
      blockNumber: recording.pinnedFinalized, blockHash: "0xf13e622ba610a394076e182398bfd72f8e7524717673ec43add927cbba3b446c",
      observedAtMs: NOW, projectionGeneration: "1",
    });
    expect(observation).not.toMatchObject({ controller: scenario.proof.owner });
    expect(server.misses).toEqual([]);
  });

  it("reports an agent the adapter never bound as not awakened, from the adapter's UnknownAgent revert", async () => {
    const { server, rpc } = await replay();
    expect(await reader(rpc).resolveAgent(identity({ agentId: "999999999" }))).toMatchObject({ kind: "not_awakened", blockNumber: recording.pinnedFinalized });
    expect(server.misses).toEqual([]);
  });

  it("does not let an identity claim a binding that belongs to another token", async () => {
    const { rpc } = await replay();
    const errors: unknown[] = [];
    expect(await reader(rpc, { errors }).resolveAgent(identity({ tokenId: "1" }))).toMatchObject({ kind: "not_awakened" });
    expect(String(errors[0])).toMatch(/bound to token 1792447321178/);
  });

  it("turns the provider's HTTP 413 for a too-wide log range into unavailable, with a redacted error", async () => {
    const { rpc } = await replay();
    const errors: unknown[] = [];
    expect(await reader(rpc, { start: scenario.wideStart, chunkBlocks: 1000, errors }).resolveAgent(identity())).toEqual({ kind: "unavailable", reason: "rpc" });
    const message = String((errors[0] as Error).message);
    expect(message).toMatch(/eth_getLogs returned HTTP 413 \(eth_getLogs is limited to a 100 range\)/);
    expect(message).not.toMatch(/secret|rpc\/|key=/);
  });

  it("reports unavailable, not a guess, when the RPC is unreachable", async () => {
    const { server, rpc } = await replay();
    await server.stop();
    expect(await reader(rpc).resolveAgent(identity())).toEqual({ kind: "unavailable", reason: "rpc" });
  });

  it("refuses identities from any other deployment", async () => {
    const { rpc } = await replay();
    await expect(reader(rpc).resolveAgent(identity({ adapter: "0x00000000000000000000000000000000000c4a77" }))).rejects.toThrow(/not from the verified deployment/);
    await expect(reader(rpc).resolveAgent(identity({ chainId: 143 }))).rejects.toThrow(/not from the verified deployment/);
  });
});
