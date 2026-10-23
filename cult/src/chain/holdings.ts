// Which Chog Genesis tokens a wallet holds, and which of them are awakened. The collection isn't enumerable, so
// the live index reads ownerOf and the adapter's agentOf for every token in Multicall3 batches, all pinned to one
// finalized block. A full read takes seconds on a public RPC, so the last answer is served at once while a newer one
// is read in the background (stale-while-revalidate). Failures give `unavailable`, never a guess.
import type { AgentIdentity, ChainReader } from "../shared/identity.js";
import { ADAPTER, COLLECTION, MULTICALL3, MULTICALL3_ADDRESS, MalformedRpcResult, ZERO_ADDRESS, parseHex, requireBlock, type BlockRef } from "./evm.js";
import type { LiveDeployment } from "./liveChainReader.js";
import type { JsonRpc } from "./rpc.js";

export interface Holding {
  readonly tokenId: string;
  /** Under the verified deployment, when the token is awakened; null while it sleeps. */
  readonly identity: AgentIdentity | null;
}

export type HoldingsResult =
  | { readonly kind: "ok"; readonly blockNumber: string; readonly tokens: readonly Holding[] }
  | { readonly kind: "unavailable" };

export interface HoldingsIndex {
  holdingsOf(address: string): Promise<HoldingsResult>;
  /** Forgets the cached answer, for example after an awakening, so the next read waits for a fresh one. */
  invalidate(): void;
  /** Starts a read in the background, so the first visitor doesn't wait for it. */
  warm(): void;
}

export interface LiveHoldingsIndexOptions {
  readonly rpc: JsonRpc;
  readonly deployment: LiveDeployment;
  /** Highest token ID to read; IDs run from 1. */
  readonly maxTokenId: number;
  /** After this long, a read starts a background refresh (the old answer is still served meanwhile). */
  readonly maxAgeMs?: number;
  /** Calls per aggregate3 request. */
  readonly batchSize?: number;
  /** aggregate3 requests sent at once. */
  readonly parallelBatches?: number;
  readonly now?: () => number;
  /** RPC and decoding failures; messages carry no RPC URL. */
  readonly onError?: (error: unknown) => void;
}

interface Snapshot {
  readonly at: BlockRef;
  readonly readAtMs: number;
  readonly byOwner: ReadonlyMap<string, readonly Holding[]>;
}

const CALL_GAS = "0x2faf080"; // 50M: a batch of view calls, never a transaction

export class LiveHoldingsIndex implements HoldingsIndex {
  readonly #rpc: JsonRpc;
  readonly #deployment: LiveDeployment;
  readonly #maxTokenId: number;
  readonly #maxAgeMs: number;
  readonly #batchSize: number;
  readonly #parallel: number;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  #snapshot: Snapshot | undefined;
  #inflight: Promise<Snapshot> | undefined;
  /** Advanced by invalidate(): a read started before it may answer its own callers but never becomes the cache. */
  #generation = 0;

  constructor(options: LiveHoldingsIndexOptions) {
    if (!Number.isSafeInteger(options.maxTokenId) || options.maxTokenId < 1) throw new Error("maxTokenId must be a positive integer.");
    this.#rpc = options.rpc;
    this.#deployment = options.deployment;
    this.#maxTokenId = options.maxTokenId;
    this.#maxAgeMs = options.maxAgeMs ?? 60_000;
    this.#batchSize = options.batchSize ?? 250;
    this.#parallel = options.parallelBatches ?? 4;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => {});
  }

  async holdingsOf(address: string): Promise<HoldingsResult> {
    try {
      const snapshot = await this.#fresh();
      return { kind: "ok", blockNumber: snapshot.at.number.toString(), tokens: snapshot.byOwner.get(address.toLowerCase()) ?? [] };
    } catch (error) {
      this.#onError(error);
      return { kind: "unavailable" };
    }
  }

  invalidate(): void {
    this.#generation += 1;
    this.#snapshot = undefined;
    this.#inflight = undefined;
  }

  warm(): void {
    this.#refresh().catch((error: unknown) => this.#onError(error));
  }

  #fresh(): Promise<Snapshot> {
    const current = this.#snapshot;
    if (!current) return this.#refresh();
    if (this.#now() - current.readAtMs > this.#maxAgeMs) this.warm();
    return Promise.resolve(current);
  }

  /** Concurrent callers share one read of the collection. */
  #refresh(): Promise<Snapshot> {
    if (!this.#inflight) {
      const generation = this.#generation;
      const read: Promise<Snapshot> = this.#read()
        .then((snapshot) => { if (generation === this.#generation) this.#snapshot = snapshot; return snapshot; })
        .finally(() => { if (this.#inflight === read) this.#inflight = undefined; });
      this.#inflight = read;
    }
    return this.#inflight;
  }

  async #read(): Promise<Snapshot> {
    const readAtMs = this.#now();
    const at = await requireBlock(this.#rpc, "finalized");
    const pinned = { blockHash: at.hash, requireCanonical: true };
    const { collection, adapter } = this.#deployment;
    const calls: { target: string; allowFailure: boolean; callData: string }[] = [];
    for (let id = 1; id <= this.#maxTokenId; id++) {
      calls.push({ target: collection, allowFailure: true, callData: COLLECTION.encodeFunctionData("ownerOf", [id]) });
      calls.push({ target: adapter, allowFailure: true, callData: ADAPTER.encodeFunctionData("agentOf", [id]) });
    }
    const batches: (typeof calls)[] = [];
    for (let start = 0; start < calls.length; start += this.#batchSize) batches.push(calls.slice(start, start + this.#batchSize));
    const answers: { success: boolean; returnData: string }[][] = new Array(batches.length);
    let next = 0;
    const worker = async () => {
      for (let index = next++; index < batches.length; index = next++) answers[index] = await this.#batch(batches[index]!, pinned);
    };
    await Promise.all(Array.from({ length: Math.min(this.#parallel, batches.length) }, worker));
    const results = answers.flat();
    if (results.length !== calls.length) throw new MalformedRpcResult(`aggregate3 answered ${results.length} of ${calls.length} calls.`);
    return { at, readAtMs, byOwner: this.#byOwner(results) };
  }

  async #batch(batch: readonly { target: string; allowFailure: boolean; callData: string }[], pinned: unknown): Promise<{ success: boolean; returnData: string }[]> {
    const raw = parseHex(await this.#rpc.request("eth_call", [
      { to: MULTICALL3_ADDRESS, data: MULTICALL3.encodeFunctionData("aggregate3", [batch]), gas: CALL_GAS }, pinned,
    ]), "aggregate3 result");
    let decoded: { success: boolean; returnData: string }[];
    try {
      decoded = (MULTICALL3.decodeFunctionResult("aggregate3", raw)[0] as { success: boolean; returnData: string }[])
        .map((entry) => ({ success: entry.success, returnData: entry.returnData }));
    } catch {
      throw new MalformedRpcResult("aggregate3 returned malformed data (is Multicall3 deployed?).");
    }
    if (decoded.length !== batch.length) throw new MalformedRpcResult(`aggregate3 answered ${decoded.length} of ${batch.length} calls.`);
    return decoded;
  }

  #byOwner(results: readonly { success: boolean; returnData: string }[]): Map<string, Holding[]> {
    const byOwner = new Map<string, Holding[]>();
    const d = this.#deployment;
    for (let index = 0; index < this.#maxTokenId; index++) {
      const tokenId = String(index + 1);
      const owner = results[2 * index]!;
      const agent = results[2 * index + 1]!;
      // A failed ownerOf is a token that doesn't exist (or was burned): nobody holds it.
      if (!owner.success) continue;
      let holder: string;
      let agentId: string | null = null;
      try {
        holder = String(COLLECTION.decodeFunctionResult("ownerOf", owner.returnData)[0]).toLowerCase();
        // agentOf reverts with NotAwakened for a sleeping Chog.
        if (agent.success) agentId = BigInt(ADAPTER.decodeFunctionResult("agentOf", agent.returnData)[0]).toString();
      } catch {
        throw new MalformedRpcResult(`Token ${tokenId} returned malformed ownerOf or agentOf data.`);
      }
      if (holder === ZERO_ADDRESS) continue;
      const identity: AgentIdentity | null = agentId === null ? null
        : { chainId: d.chainId, registry: d.registry, adapter: d.adapter, collection: d.collection, tokenId, agentId };
      byOwner.set(holder, [...(byOwner.get(holder) ?? []), { tokenId, identity }]);
    }
    return byOwner;
  }
}

/** Local fixture only: the fixture Chogs, with holders from the fixture ownership (so transfers show up). */
export class FixtureHoldingsIndex implements HoldingsIndex {
  readonly #chogs: readonly { readonly identity: AgentIdentity }[];
  readonly #reader: ChainReader;

  constructor(chogs: readonly { readonly identity: AgentIdentity }[], reader: ChainReader) {
    this.#chogs = chogs;
    this.#reader = reader;
  }

  async holdingsOf(address: string): Promise<HoldingsResult> {
    const tokens: Holding[] = [];
    for (const chog of this.#chogs) {
      const observation = await this.#reader.resolveAgent(chog.identity);
      if (observation.kind === "unavailable") return { kind: "unavailable" };
      if (observation.kind === "controlled" && observation.controller.toLowerCase() === address.toLowerCase()) tokens.push({ tokenId: chog.identity.tokenId, identity: chog.identity });
    }
    return { kind: "ok", blockNumber: "0", tokens };
  }

  invalidate(): void {}

  warm(): void {}
}
