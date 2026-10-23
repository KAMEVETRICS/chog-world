// Behaviour every ProjectionStore must have; run against the memory store and PostgreSQL.
import { expect, it } from "vitest";
import { ZERO_ADDRESS } from "../../src/chain/evm.js";
import { LiveChainReader } from "../../src/chain/liveChainReader.js";
import { ownershipEpoch, type ProjectionConfig, type ProjectionStore, type TransferRecord } from "../../src/chain/projection.js";
import { ADAPTER_ADDRESS, COLLECTION, FakeChain, REGISTRY } from "./fakeChain.js";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const config: ProjectionConfig = { chainId: 143, collection: COLLECTION, activation: { number: 100n, hash: hash(100) } };
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const transfer = (block: number, logIndex: number, tokenId: string, from: string, to: string, blockHash = hash(block)): TransferRecord =>
  ({ blockNumber: BigInt(block), blockHash, logIndex, transactionHash: hash(block * 100 + logIndex), tokenId, from, to });

export function projectionStoreContract(makeStore: () => Promise<ProjectionStore>): void {
  it("opens at the activation block and refuses a different activation hash later", async () => {
    const store = await makeStore();
    expect(await store.open(config)).toEqual({ cursor: config.activation, generation: 1n, checkpoints: [config.activation] });
    await expect(store.open({ ...config, activation: { number: 100n, hash: hash(999) } })).rejects.toThrow(/different activation block/);
  });

  it("stores transfers and answers token reads from one head", async () => {
    const store = await makeStore();
    const head = await store.open(config);
    const next = await store.apply(config, head, { kind: "advance", to: { number: 110n, hash: hash(110) }, transfers: [
      transfer(103, 0, "7", ZERO_ADDRESS, A), transfer(105, 2, "7", A, B), transfer(105, 1, "8", ZERO_ADDRESS, B), transfer(109, 0, "7", B, A),
    ] }, 64);
    expect(next).toMatchObject({ cursor: { number: 110n }, generation: 1n });
    const token = await store.token(config, "7");
    expect(token).toMatchObject({ cursor: { number: 110n, hash: hash(110) }, generation: 1n, canonicalTransfers: 3, orphanedTransfers: 0 });
    expect(token.latest).toMatchObject({ blockNumber: 109n, from: B, to: A, logIndex: 0 });
    expect(await store.token(config, "9")).toMatchObject({ canonicalTransfers: 0, latest: null });
  });

  it("refuses an update from a stale head (compare and set)", async () => {
    const store = await makeStore();
    const head = await store.open(config);
    expect(await store.apply(config, head, { kind: "advance", to: { number: 101n, hash: hash(101) }, transfers: [] }, 64)).not.toBeNull();
    expect(await store.apply(config, head, { kind: "advance", to: { number: 102n, hash: hash(102) }, transfers: [] }, 64)).toBeNull();
    await expect(store.apply(config, await store.open(config), { kind: "advance", to: { number: 105n, hash: hash(105) }, transfers: [transfer(101, 0, "7", A, B)] }, 64)).rejects.toThrow(/outside/);
  });

  it("rewinds to a checkpoint: later transfers are orphaned, the generation advances and epochs only grow", async () => {
    const store = await makeStore();
    let head = (await store.apply(config, await store.open(config), { kind: "advance", to: { number: 104n, hash: hash(104) }, transfers: [transfer(102, 0, "7", A, B)] }, 64))!;
    head = (await store.apply(config, head, { kind: "advance", to: { number: 108n, hash: hash(108) }, transfers: [transfer(106, 0, "7", B, A)] }, 64))!;
    expect(ownershipEpoch(await store.token(config, "7"))).toBe("3");
    await expect(store.apply(config, head, { kind: "rewind", to: { number: 106n, hash: hash(106) } }, 64)).rejects.toThrow(/retained checkpoint/);
    head = (await store.apply(config, head, { kind: "rewind", to: { number: 104n, hash: hash(104) } }, 64))!;
    expect(head).toEqual({ cursor: { number: 104n, hash: hash(104) }, generation: 2n, checkpoints: [config.activation, { number: 104n, hash: hash(104) }] });
    expect(await store.token(config, "7")).toMatchObject({ canonicalTransfers: 1, orphanedTransfers: 1, latest: { to: B } });
    expect(ownershipEpoch(await store.token(config, "7"))).toBe("4");
    // The same log can come back on the new chain: it is stored again, and counted again.
    head = (await store.apply(config, head, { kind: "advance", to: { number: 108n, hash: hash(1108) }, transfers: [transfer(106, 0, "7", B, A, hash(1106))] }, 64))!;
    expect(await store.token(config, "7")).toMatchObject({ canonicalTransfers: 2, orphanedTransfers: 1, latest: { to: A, blockHash: hash(1106) } });
    expect(ownershipEpoch(await store.token(config, "7"))).toBe("5");
  });

  it("keeps the activation block and the newest checkpoints only", async () => {
    const store = await makeStore();
    let head = await store.open(config);
    for (let block = 101; block <= 110; block++) head = (await store.apply(config, head, { kind: "advance", to: { number: BigInt(block), hash: hash(block) }, transfers: [] }, 3))!;
    expect(head.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([100n, 108n, 109n, 110n]);
    expect((await store.open(config)).checkpoints).toEqual(head.checkpoints);
  });

  it("serves the live reader through A→B→A and a reorg", async () => {
    const store = await makeStore();
    const chain = new FakeChain(3);
    const activation = chain.mine();
    chain.mine([{ tokenId: 7n, from: ZERO_ADDRESS, to: A }], [[70n, 7n]]);
    const reader = new LiveChainReader({
      rpc: chain, store, chunkBlocks: 2, maxAgeMs: -1, deployment: { chainId: 143, registry: REGISTRY, adapter: ADAPTER_ADDRESS, collection: COLLECTION, activation },
    });
    const identity = { chainId: 143 as const, registry: REGISTRY, adapter: ADAPTER_ADDRESS, collection: COLLECTION, tokenId: "7", agentId: "70" };
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: A, ownershipEpoch: "2" });
    const sale = chain.mine([{ tokenId: 7n, from: A, to: B }]);
    chain.mine([{ tokenId: 7n, from: B, to: A }]);
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: A, ownershipEpoch: "4", projectionGeneration: "1" });
    chain.reorgFrom(sale.number);
    chain.mineEmpty(3);
    // Both orphaned transfers count twice: 1 + mint + 2 × 2.
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: A, ownershipEpoch: "6", projectionGeneration: "2" });
  });
}
