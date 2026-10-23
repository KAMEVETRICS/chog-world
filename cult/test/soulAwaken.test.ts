import { describe, expect, it, vi } from "vitest";
import { ADAPTER, COLLECTION, MULTICALL3, MULTICALL3_ADDRESS } from "../src/chain/evm.js";
import { LiveHoldingsIndex } from "../src/chain/holdings.js";
import type { JsonRpc } from "../src/chain/rpc.js";
import { genesisImageIpfs } from "../src/citysim/world.js";
import { REGISTRATION_TYPE, agentURIFor, awakenPlan, registrationFile } from "../src/soul/awakening.js";

const DEPLOYMENT = {
  chainId: 143 as const, registry: "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432", adapter: "0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02",
  collection: "0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763", activation: { number: 115003560n, hash: `0x${"a5".repeat(32)}` },
};
const ALICE = "0x00000000000000000000000000000000000a11ce";
const BOB = "0x0000000000000000000000000000000000000b0b";

describe("awakening", () => {
  it("puts an ERC-8004 registration file on chain as a data: URI, with the Chog's art on IPFS", () => {
    const uri = agentURIFor("123");
    expect(uri).toMatch(/^data:application\/json;base64,/);
    const file = JSON.parse(Buffer.from(uri.split(",")[1]!, "base64").toString("utf8"));
    expect(file).toEqual(registrationFile("123"));
    expect(file).toMatchObject({ type: REGISTRATION_TYPE, name: "Chog #123", image: expect.stringMatching(/^ipfs:\/\/[^/]+\/.+\.webp$/) });
    expect(file.image).toBe(genesisImageIpfs("123"));
    expect(uri.length).toBeLessThan(800);
    // A token outside the collection gets no image rather than a wrong one.
    expect(registrationFile("5000")).not.toHaveProperty("image");
  });

  it("prepares awaken(tokenId, agentURI) for the adapter on Monad, and nothing else", () => {
    const plan = awakenPlan({ chainId: 143, adapter: DEPLOYMENT.adapter }, "123");
    expect(plan).toMatchObject({ chainId: 143, to: DEPLOYMENT.adapter, agentURI: agentURIFor("123") });
    const call = ADAPTER.parseTransaction({ data: plan.data })!;
    expect(call.name).toBe("awaken");
    expect(call.args.map(String)).toEqual(["123", agentURIFor("123")]);
  });
});

/** A chain that answers Multicall3 batches of ownerOf and agentOf from tables. */
function fakeChain(owners: Record<number, string>, agents: Record<number, number>) {
  const stats = { batches: 0, blocks: 0 };
  const rpc: JsonRpc & { broken: boolean } = {
    host: "fake.rpc", broken: false,
    close() {},
    async request(method, params) {
      if (method === "eth_getBlockByNumber") { stats.blocks += 1; return { number: "0x10", hash: `0x${"b".repeat(64)}` }; }
      if (method !== "eth_call") throw new Error(`unexpected ${method}`);
      const { to, data } = params[0] as { to: string; data: string };
      expect(to).toBe(MULTICALL3_ADDRESS);
      expect(params[1]).toEqual({ blockHash: `0x${"b".repeat(64)}`, requireCanonical: true });
      if (rpc.broken) return "0x1234";
      stats.batches += 1;
      const calls = MULTICALL3.decodeFunctionData("aggregate3", data)[0] as { target: string; callData: string }[];
      const results = calls.map(({ target, callData }) => {
        if (target.toLowerCase() === DEPLOYMENT.collection) {
          const id = Number(COLLECTION.decodeFunctionData("ownerOf", callData)[0]);
          return owners[id] ? [true, COLLECTION.encodeFunctionResult("ownerOf", [owners[id]])] : [false, "0x"];
        }
        const id = Number(ADAPTER.decodeFunctionData("agentOf", callData)[0]);
        return agents[id] ? [true, ADAPTER.encodeFunctionResult("agentOf", [agents[id]])] : [false, ADAPTER.encodeErrorResult("NotAwakened", [id])];
      });
      return MULTICALL3.encodeFunctionResult("aggregate3", [results]);
    },
  };
  return { rpc, stats };
}

describe("holdings index", () => {
  it("finds every token a wallet holds and which are awake, in Multicall3 batches at one finalized block", async () => {
    const { rpc, stats } = fakeChain({ 1: ALICE, 2: BOB, 3: ALICE, 5: ALICE.toUpperCase().replace("0X", "0x") }, { 3: 4107 });
    let clock = 1_000;
    const index = new LiveHoldingsIndex({ rpc, deployment: DEPLOYMENT, maxTokenId: 6, batchSize: 4, parallelBatches: 2, now: () => clock });
    const mine = await index.holdingsOf(ALICE);
    expect(mine).toEqual({
      kind: "ok", blockNumber: "16", tokens: [
        { tokenId: "1", identity: null },
        { tokenId: "3", identity: { chainId: 143, registry: DEPLOYMENT.registry, adapter: DEPLOYMENT.adapter, collection: DEPLOYMENT.collection, tokenId: "3", agentId: "4107" } },
        { tokenId: "5", identity: null },
      ],
    });
    expect(stats.batches).toBe(3); // 12 calls in batches of 4
    expect(await index.holdingsOf(BOB)).toMatchObject({ tokens: [{ tokenId: "2", identity: null }] });
    expect(await index.holdingsOf("0x00000000000000000000000000000000000000ff")).toMatchObject({ kind: "ok", tokens: [] });
    expect(stats.blocks).toBe(1); // one read serves everyone for a minute

    // After a minute the old answer is still served at once, while a newer one is read in the background.
    clock += 61_000;
    await index.holdingsOf(ALICE);
    await vi.waitFor(() => expect(stats.blocks).toBe(2));
    // After an awakening, the next read waits for a fresh answer.
    index.invalidate();
    await index.holdingsOf(ALICE);
    expect(stats.blocks).toBe(3);
  });

  it("reports unavailable, never a guess, when the batch answer is malformed", async () => {
    const { rpc } = fakeChain({ 1: ALICE }, {});
    const errors: unknown[] = [];
    const index = new LiveHoldingsIndex({ rpc, deployment: DEPLOYMENT, maxTokenId: 2, onError: (error) => errors.push(error) });
    rpc.broken = true;
    expect(await index.holdingsOf(ALICE)).toEqual({ kind: "unavailable" });
    expect(String(errors[0])).toMatch(/aggregate3 returned malformed data/);
    rpc.broken = false;
    expect(await index.holdingsOf(ALICE)).toMatchObject({ kind: "ok", tokens: [{ tokenId: "1" }] });
  });
});
