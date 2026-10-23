import { describe, expect, it } from "vitest";
import { ADAPTER, ZERO_ADDRESS } from "../../src/chain/evm.js";
import { LiveChainReader, type LiveChainReaderOptions } from "../../src/chain/liveChainReader.js";
import { MemoryProjectionStore, ownershipEpoch, projectionScope } from "../../src/chain/projection.js";
import { RpcError } from "../../src/chain/rpc.js";
import type { AgentIdentity, ControlObservation } from "../../src/shared/identity.js";
import { ADAPTER_ADDRESS, COLLECTION, FakeChain, REGISTRY } from "./fakeChain.js";

const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const CONTROLLER_OF = ADAPTER.getFunction("controllerOf")!.selector;

function world(options: Partial<LiveChainReaderOptions> = {}) {
  const chain = new FakeChain(5);
  chain.mine([{ tokenId: 7n, from: ZERO_ADDRESS, to: A }]); // minted before the adapter existed: not counted
  const activation = chain.mine(); // the adapter's deployment block
  chain.mine([], [[70n, 7n]]); // agent 70 awakened for token 7
  const store = new MemoryProjectionStore();
  let clock = 1_000_000;
  const errors: unknown[] = [];
  const deployment = { chainId: 143 as const, registry: REGISTRY, adapter: ADAPTER_ADDRESS, collection: COLLECTION, activation };
  const make = (extra: Partial<LiveChainReaderOptions> = {}) => new LiveChainReader({
    rpc: chain, store, deployment, chunkBlocks: 10, maxAgeMs: 0, now: () => (clock += 1), onError: (error) => errors.push(error), ...options, ...extra,
  });
  const identity: AgentIdentity = { chainId: 143, registry: REGISTRY, adapter: ADAPTER_ADDRESS, collection: COLLECTION, tokenId: "7", agentId: "70" };
  return { chain, store, reader: make(), make, errors, identity, activation, config: { chainId: 143, collection: COLLECTION, activation } };
}

const epochs = (observations: ControlObservation[]) => observations.map((o) => (o.kind === "unavailable" ? null : Number(o.ownershipEpoch)));

describe("live chain reader: ownership", () => {
  it("advances the epoch on every transfer, so A→B→A never revives the first epoch", async () => {
    const { chain, reader, identity } = world();
    const first = await reader.resolveAgent(identity);
    expect(first).toMatchObject({ kind: "controlled", controller: A, ownershipEpoch: "1", projectionGeneration: "1", blockNumber: String(chain.head.number), blockHash: chain.head.hash });
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    const sold = await reader.resolveAgent(identity);
    expect(sold).toMatchObject({ kind: "controlled", controller: B, ownershipEpoch: "2" });
    chain.mine([{ tokenId: 7n, from: B, to: A }]);
    const back = await reader.resolveAgent(identity);
    expect(back).toMatchObject({ kind: "controlled", controller: A, ownershipEpoch: "3" });
  });

  it("counts several transfers of one token in one block, in log order", async () => {
    const { chain, reader, identity } = world();
    chain.mine([{ tokenId: 7n, from: A, to: B }, { tokenId: 7n, from: B, to: C }, { tokenId: 7n, from: C, to: A }]);
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: A, ownershipEpoch: "4" });
  });

  it("classifies a burn from the burn log, and refuses to call a missing owner a burn without one", async () => {
    const { chain, reader, identity } = world();
    chain.mine([{ tokenId: 7n, from: A, to: ZERO_ADDRESS }]);
    expect(await reader.resolveAgent(identity)).toMatchObject({ kind: "burned", ownershipEpoch: "2" });

    const other = world();
    // The collection stops answering ownerOf, but no Transfer to the zero address exists.
    other.chain.intercept = (method, params) => {
      if (method === "eth_call" && (params[0] as { data: string }).data.startsWith(CONTROLLER_OF)) throw new RpcError("RPC fake.rpc eth_call reverted 3", "reverted", method, 3, "0x");
      return undefined;
    };
    expect(await other.reader.resolveAgent(other.identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    expect(String(other.errors.at(-1))).toMatch(/no owner at block \d+, but the projection holds no burn of token 7/);
  });

  it("reports unavailable when the owner on chain disagrees with the indexed transfers", async () => {
    const { chain, reader, identity, errors } = world();
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    chain.intercept = (method, params) => (method === "eth_call" && (params[0] as { data: string }).data.startsWith(CONTROLLER_OF) ? ADAPTER.encodeFunctionResult("controllerOf", [C]) : undefined);
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "indexer_lag" });
    expect(String(errors.at(-1))).toMatch(/held by 0x0+c3, but its latest indexed transfer went to 0x0+b2/);
  });

  it("reports not awakened until the adapter binds the agent, with the token's real epoch", async () => {
    const { chain, reader } = world();
    chain.mine([{ tokenId: 8n, from: ZERO_ADDRESS, to: B }]);
    const pending: AgentIdentity = { chainId: 143, registry: REGISTRY, adapter: ADAPTER_ADDRESS, collection: COLLECTION, tokenId: "8", agentId: "71" };
    expect(await reader.resolveAgent(pending)).toMatchObject({ kind: "not_awakened", ownershipEpoch: "2" });
    chain.mine([], [[71n, 8n]]);
    expect(await reader.resolveAgent(pending)).toMatchObject({ kind: "controlled", controller: B, ownershipEpoch: "2" });
  });

  it("caches a binding only within one projection generation", async () => {
    const { chain, reader, identity } = world();
    await reader.resolveAgent(identity);
    const before = chain.calls.length;
    chain.mine();
    await reader.resolveAgent(identity);
    const calls = chain.calls.slice(before);
    expect(calls.filter((method) => method === "eth_call")).toHaveLength(1); // controllerOf only
  });
});

describe("live chain reader: reorgs", () => {
  it("rewinds to the last common checkpoint, advances the generation, and keeps epochs growing", async () => {
    const { chain, reader, identity, errors } = world({ chunkBlocks: 1 });
    const seen: ControlObservation[] = [await reader.resolveAgent(identity)];
    const sale = chain.mine([{ tokenId: 7n, from: A, to: B }]);
    seen.push(await reader.resolveAgent(identity));
    expect(seen[1]).toMatchObject({ controller: B, projectionGeneration: "1" });

    chain.reorgFrom(sale.number); // the sale never happened on the new chain
    chain.mineEmpty(2);
    seen.push(await reader.resolveAgent(identity));
    expect(seen[2]).toMatchObject({ kind: "controlled", controller: A, projectionGeneration: "2", blockHash: chain.head.hash });
    expect(errors.map(String).join("\n")).toMatch(/rewound from block \d+ to \d+ \(generation 2\)/);

    chain.mine([{ tokenId: 7n, from: A, to: B }]); // the sale lands again in a later block
    seen.push(await reader.resolveAgent(identity));
    expect(seen[3]).toMatchObject({ controller: B, projectionGeneration: "2" });
    expect(epochs(seen)).toEqual([1, 2, 3, 4]);
  });

  it("rebuilds from the activation block when the reorg is deeper than the retained checkpoints", async () => {
    const { chain, reader, identity, store, config } = world({ chunkBlocks: 1, retainCheckpoints: 2 });
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    chain.mineEmpty(5);
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: B, ownershipEpoch: "2" });
    expect((await store.open(config)).checkpoints).toHaveLength(3); // activation + 2

    chain.reorgFrom(config.activation.number + 1n);
    chain.mine([], [[70n, 7n]]);
    chain.mine([{ tokenId: 7n, from: A, to: C }]);
    chain.mineEmpty(3);
    // Shorter than the indexed chain so far: the node has no block at the old cursor height yet.
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    chain.mineEmpty(3);
    const after = await reader.resolveAgent(identity);
    expect(after).toMatchObject({ kind: "controlled", controller: C, projectionGeneration: "2" });
    // 1 + one canonical transfer + 2 × one orphaned transfer
    expect(after).toMatchObject({ ownershipEpoch: "4" });
  });

  it("stops with `reorg` when the activation block itself is no longer canonical", async () => {
    const { chain, reader, identity, errors, activation } = world();
    await reader.resolveAgent(identity);
    chain.reorgFrom(activation.number);
    chain.mineEmpty(3);
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "reorg" });
    expect(String(errors.at(-1))).toMatch(/activation block \d+ is no longer canonical; re-verify the deployment manifest/);
  });

  it("does not store logs when block `to` changes while they are read", async () => {
    const { chain, reader, identity, store, config } = world();
    await reader.resolveAgent(identity);
    const cursor = (await store.open(config)).cursor;
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    let swapped = false;
    chain.intercept = (method) => {
      if (method === "eth_getLogs" && !swapped) { swapped = true; chain.reorgFrom(chain.head.number); chain.mine(); }
      return undefined;
    };
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "reorg" });
    expect((await store.open(config)).cursor).toEqual(cursor);
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: A, ownershipEpoch: "1", projectionGeneration: "1" });
  });

  it("reads several chunks at once while catching up, with the same result as one at a time", async () => {
    const sequential = world({ chunkBlocks: 3 });
    const parallel = world({ chunkBlocks: 3, parallelRequests: 4 });
    for (const { chain } of [sequential, parallel]) {
      chain.mine([{ tokenId: 7n, from: A, to: B }]);
      chain.mineEmpty(7);
      chain.mine([{ tokenId: 7n, from: B, to: C }, { tokenId: 7n, from: C, to: A }]);
      chain.mineEmpty(20);
      chain.mine([{ tokenId: 7n, from: A, to: B }]);
    }
    let inflight = 0;
    let most = 0;
    parallel.chain.intercept = async (method) => {
      if (method !== "eth_getLogs") return undefined;
      most = Math.max(most, ++inflight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inflight -= 1;
      return undefined;
    };
    const one = await sequential.reader.resolveAgent(sequential.identity);
    const many = await parallel.reader.resolveAgent(parallel.identity);
    expect(many).toMatchObject({ kind: "controlled", controller: B, ownershipEpoch: "5", blockNumber: String(parallel.chain.head.number) });
    expect({ ...many, observedAtMs: 0, blockHash: "" }).toEqual({ ...one, observedAtMs: 0, blockHash: "" });
    expect(most).toBe(4);
    expect((await parallel.store.open(parallel.config)).cursor).toEqual(parallel.chain.head);
  });

  it("still stores nothing when the last block of a parallel window changes while its logs are read", async () => {
    const { chain, reader, identity, store, config } = world({ chunkBlocks: 2, parallelRequests: 4 });
    await reader.resolveAgent(identity);
    const cursor = (await store.open(config)).cursor;
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    chain.mineEmpty(5);
    let swapped = false;
    chain.intercept = (method) => {
      if (method === "eth_getLogs" && !swapped) { swapped = true; chain.reorgFrom(chain.head.number); chain.mine(); }
      return undefined;
    };
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "reorg" });
    expect((await store.open(config)).cursor).toEqual(cursor);
    expect(await reader.resolveAgent(identity)).toMatchObject({ controller: B, ownershipEpoch: "2" });
  });

  it("treats a node that lacks an indexed block as an RPC failure, not a reorg", async () => {
    const { chain, reader, identity, store, config } = world();
    await reader.resolveAgent(identity);
    const head = await store.open(config);
    chain.mineEmpty(2);
    chain.intercept = (method, params) => (method === "eth_getBlockByNumber" && params[0] === `0x${head.cursor.number.toString(16)}` ? null : undefined);
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    expect((await store.open(config)).generation).toBe(1n);
  });
});

describe("live chain reader: failures and freshness", () => {
  it("reports indexer lag while far behind, then catches up", async () => {
    const { chain, reader, identity } = world({ chunkBlocks: 10, maxChunksPerPass: 1 });
    chain.mineEmpty(50);
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "indexer_lag" });
    const result = await reader.catchUp();
    expect(result.caughtUp).toBe(true);
    expect(await reader.resolveAgent(identity)).toMatchObject({ kind: "controlled", controller: A });
  });

  it("retries a few failed passes while catching up, and gives up after five in a row", async () => {
    const { chain, reader, identity } = world({ chunkBlocks: 10, maxChunksPerPass: 1 });
    chain.mineEmpty(30);
    let failures = 0;
    chain.intercept = (method) => {
      if (method === "eth_getLogs" && failures < 2) { failures += 1; throw new Error("transient"); }
      return undefined;
    };
    expect((await reader.catchUp(undefined, 1)).caughtUp).toBe(true);
    expect(await reader.resolveAgent(identity)).toMatchObject({ kind: "controlled" });

    const broken = world();
    broken.chain.intercept = (method) => { if (method === "eth_getBlockByNumber") throw new Error("down"); return undefined; };
    await expect(broken.reader.catchUp(undefined, 1)).rejects.toThrow("down");
    expect(broken.errors).toHaveLength(5);
  });

  it("answers within its budget when the RPC hangs", async () => {
    const syncing = world({ budgetMs: 50 });
    syncing.chain.intercept = () => new Promise(() => {});
    const started = Date.now();
    expect(await syncing.reader.resolveAgent(syncing.identity)).toEqual({ kind: "unavailable", reason: "indexer_lag" });
    expect(Date.now() - started).toBeLessThan(1000);

    const calling = world({ budgetMs: 50 });
    calling.chain.intercept = (method) => (method === "eth_call" ? new Promise(() => {}) : undefined);
    expect(await calling.reader.resolveAgent(calling.identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    expect(String(calling.errors.at(-1))).toMatch(/not resolved within 50ms/);
  });

  it("refuses malformed logs instead of skipping them", async () => {
    const { chain, reader, identity, errors } = world();
    chain.mine();
    chain.intercept = (method) => (method === "eth_getLogs"
      ? [{ address: COLLECTION, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${"00".repeat(32)}`, `0x${"00".repeat(32)}`], blockNumber: `0x${chain.head.number.toString(16)}`, blockHash: chain.head.hash, logIndex: "0x0", transactionHash: `0x${"ab".repeat(32)}` }]
      : undefined);
    expect(await reader.resolveAgent(identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    expect(String(errors.at(-1))).toMatch(/not an ERC-721 Transfer/);
  });

  it("shares one projection pass between concurrent reads and reuses a fresh one", async () => {
    const { chain, make, identity } = world();
    let clock = 0;
    const reader = make({ maxAgeMs: 1_000, now: () => clock });
    await Promise.all(Array.from({ length: 5 }, () => reader.resolveAgent(identity)));
    expect(chain.calls.filter((method) => method === "eth_getLogs")).toHaveLength(1);
    const finalizedReads = () => chain.calls.filter((method) => method === "eth_getBlockByNumber").length;
    const before = finalizedReads();
    clock += 500;
    await reader.resolveAgent(identity);
    expect(finalizedReads()).toBe(before);
    clock += 1_000;
    await reader.resolveAgent(identity);
    expect(finalizedReads()).toBeGreaterThan(before);
  });

  it("lets two readers share one store without double-counting transfers", async () => {
    const { chain, make, identity, store, config } = world();
    const [first, second] = [make(), make()];
    await Promise.all([first.resolveAgent(identity), second.resolveAgent(identity)]);
    chain.mine([{ tokenId: 7n, from: A, to: B }]);
    chain.mineEmpty(3);
    const results = await Promise.all([first.resolveAgent(identity), second.resolveAgent(identity), first.resolveAgent(identity)]);
    for (const result of results) expect(result).toMatchObject({ controller: B, ownershipEpoch: "2" });
    expect((await store.token(config, "7")).canonicalTransfers).toBe(1);
  });

  it("follows the chain in the background once started", async () => {
    const { chain, reader, store, config } = world({ pollMs: 5 });
    reader.start();
    chain.mineEmpty(30);
    for (let i = 0; i < 200 && (await store.open(config)).cursor.number < chain.head.number; i++) await new Promise((resolve) => setTimeout(resolve, 5));
    await reader.stop();
    expect((await store.open(config)).cursor).toEqual(chain.head);
  });
});

describe("projection store and epochs", () => {
  it("keeps the activation block and the newest checkpoints", async () => {
    const { chain, reader, identity, store, config, activation } = world({ chunkBlocks: 1, retainCheckpoints: 3 });
    chain.mineEmpty(10);
    await reader.resolveAgent(identity);
    const head = await store.open(config);
    expect(head.checkpoints.map((checkpoint) => checkpoint.number)).toEqual([activation.number, chain.head.number - 2n, chain.head.number - 1n, chain.head.number]);
    expect(projectionScope(config)).toBe(`143:${COLLECTION}:${activation.number}`);
  });

  it("derives epochs that only grow", () => {
    expect(ownershipEpoch({ canonicalTransfers: 0, orphanedTransfers: 0 })).toBe("1");
    expect(ownershipEpoch({ canonicalTransfers: 2, orphanedTransfers: 1 })).toBe("5");
  });
});
