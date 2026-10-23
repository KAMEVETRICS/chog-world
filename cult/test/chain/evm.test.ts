// The live reader against the real ChogAdapter on a local EVM (Hardhat EDR, chain 143), over HTTP.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Contract } from "ethers";
import { LiveAgentDirectory } from "../../src/chain/agentDirectory.js";
import { LiveChainReader } from "../../src/chain/liveChainReader.js";
import { verifyManifest, type VerifiedManifest } from "../../src/chain/manifest.js";
import { MemoryProjectionStore } from "../../src/chain/projection.js";
import { HttpJsonRpc } from "../../src/chain/rpc.js";
import type { AgentIdentity, ControlObservation } from "../../src/shared/identity.js";
import { startLocalEvm, type LocalEvm } from "./localEvm.js";

let evm: LocalEvm;
let rpc: HttpJsonRpc;
let verified: VerifiedManifest;
let address: { alice: string; bob: string; carol: string };

beforeAll(async () => {
  evm = await startLocalEvm([7n, 8n, 9n, 10n]);
  rpc = new HttpJsonRpc({ url: evm.url });
  verified = await verifyManifest(rpc, evm.manifest);
  const [alice, bob, carol] = await Promise.all(evm.signers.slice(0, 3).map((signer) => signer.getAddress()));
  address = { alice: alice!.toLowerCase(), bob: bob!.toLowerCase(), carol: carol!.toLowerCase() };
}, 60_000);

afterAll(async () => {
  rpc?.close();
  await evm?.close();
});

async function awaken(tokenId: bigint, signer = 0): Promise<AgentIdentity> {
  const adapter = evm.adapter.connect(evm.signers[signer]!) as Contract;
  await (await adapter.getFunction("awaken")(tokenId, `ipfs://chog-${tokenId}`)).wait();
  const agentId = await adapter.getFunction("agentOf")(tokenId) as bigint;
  return { chainId: 143, registry: evm.manifest.registry, adapter: evm.manifest.adapter, collection: evm.manifest.collection, tokenId: tokenId.toString(), agentId: agentId.toString() };
}

async function transfer(tokenId: bigint, from: number, to: string): Promise<void> {
  const collection = evm.collection.connect(evm.signers[from]!) as Contract;
  await (await collection.getFunction("transferFrom")(await evm.signers[from]!.getAddress(), to, tokenId)).wait();
}

function reader(errors: unknown[] = []) {
  return new LiveChainReader({ rpc, store: new MemoryProjectionStore(), deployment: verified.deployment, chunkBlocks: 3, maxAgeMs: 0, onError: (error) => errors.push(error) });
}

describe("live chain reader on a local EVM with the real adapter", () => {
  it("verifies the manifest of the local deployment and refuses a mismatched one", async () => {
    expect(verified.deployment).toMatchObject({ chainId: 143, adapter: evm.manifest.adapter, activation: { number: BigInt(evm.manifest.activationBlock) } });
    await expect(verifyManifest(rpc, { ...evm.manifest, collection: evm.manifest.registry })).rejects.toThrow(/built for a different collection/);
    await expect(verifyManifest(rpc, { ...evm.manifest, registry: evm.manifest.collection })).rejects.toThrow(/built for a different identity registry/);
    await expect(verifyManifest(rpc, { ...evm.manifest, adapter: evm.manifest.collection })).rejects.toThrow(/did not create the manifest's adapter/);
  });

  it("follows A→B→A with a new epoch each time, then a burn", async () => {
    const live = reader();
    const identity = await awaken(7n);
    const seen: ControlObservation[] = [await live.resolveAgent(identity)];
    expect(seen[0]).toMatchObject({ kind: "controlled", controller: address.alice, ownershipEpoch: "1", projectionGeneration: "1" });

    await transfer(7n, 0, address.bob);
    seen.push(await live.resolveAgent(identity));
    expect(seen[1]).toMatchObject({ kind: "controlled", controller: address.bob, ownershipEpoch: "2" });

    await transfer(7n, 1, address.alice);
    seen.push(await live.resolveAgent(identity));
    expect(seen[2]).toMatchObject({ kind: "controlled", controller: address.alice, ownershipEpoch: "3" });

    await (await (evm.collection.connect(evm.signers[0]!) as Contract).getFunction("burn")(7n)).wait();
    seen.push(await live.resolveAgent(identity));
    expect(seen[3]).toMatchObject({ kind: "burned", ownershipEpoch: "4" });

    const latest = await evm.provider.getBlock("latest");
    expect(seen[3]).toMatchObject({ blockNumber: String(latest!.number), blockHash: latest!.hash });
  });

  it("finds the agent a token was awakened as from the adapter, and never guesses when the RPC fails", async () => {
    const directory = new LiveAgentDirectory({ rpc, deployment: verified.deployment, traitsOf: (tokenId) => ({ Head: `Hat ${tokenId}` }) });
    expect(await directory.lookup("10")).toEqual({ kind: "not_awakened" });
    const identity = await awaken(10n);
    expect(await directory.lookup("10")).toEqual({ kind: "awakened", name: "Chog #10", traits: { Head: "Hat 10" }, identity: { ...verified.deployment, activation: undefined, tokenId: "10", agentId: identity.agentId } });
    const errors: unknown[] = [];
    const offline = new HttpJsonRpc({ url: "http://127.0.0.1:9", timeoutMs: 2_000 });
    const down = new LiveAgentDirectory({ rpc: offline, deployment: verified.deployment, onError: (error) => errors.push(error) });
    expect(await down.lookup("10")).toEqual({ kind: "unavailable" });
    expect(errors).toHaveLength(1);
    offline.close();
  });

  it("reports a token that was never awakened, and an agent bound to another token, as not awakened", async () => {
    const errors: unknown[] = [];
    const live = reader(errors);
    const identity = await awaken(8n);
    expect(await live.resolveAgent({ ...identity, agentId: (BigInt(identity.agentId) + 100n).toString() })).toMatchObject({ kind: "not_awakened" });
    expect(await live.resolveAgent({ ...identity, tokenId: "9" })).toMatchObject({ kind: "not_awakened" });
    expect(String(errors.at(-1))).toMatch(/bound to token 8/);
    expect(await live.resolveAgent(identity)).toMatchObject({ kind: "controlled", controller: address.alice });
  });

  it("rewinds a reorg (snapshot and revert) and never repeats the seller's epoch", async () => {
    const errors: unknown[] = [];
    const live = reader(errors);
    const identity = await awaken(9n);
    expect(await live.resolveAgent(identity)).toMatchObject({ controller: address.alice, ownershipEpoch: "1", projectionGeneration: "1" });
    const snapshot = await evm.request("evm_snapshot");

    await transfer(9n, 0, address.bob);
    expect(await live.resolveAgent(identity)).toMatchObject({ controller: address.bob, ownershipEpoch: "2", projectionGeneration: "1" });

    // The sale to Bob is dropped; on the new chain Alice sells to Carol instead.
    await evm.request("evm_revert", [snapshot]);
    await transfer(9n, 0, address.carol);
    const after = await live.resolveAgent(identity);
    expect(after).toMatchObject({ kind: "controlled", controller: address.carol, projectionGeneration: "2" });
    // 1 + Carol's transfer + 2 × the orphaned sale to Bob
    expect(after).toMatchObject({ ownershipEpoch: "4" });
    expect(errors.map(String).join("\n")).toMatch(/rewound from block/);
  });
});
