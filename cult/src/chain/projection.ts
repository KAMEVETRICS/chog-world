// Transfer-log projection for one ERC-721 collection (City design, sections 6–7). It indexes every
// Transfer log of the collection from the adapter's activation block up to the chain's finalized head,
// keeps block-hash checkpoints, and rewinds to the newest checkpoint that is still canonical when the
// chain reorganizes. The ownership epoch of a token is derived from it and never goes backwards.
import { RpcError, type JsonRpc } from "./rpc.js";
import { MalformedRpcResult, TRANSFER_TOPIC, getBlock, parseAddress, parseHash, parseQuantity, quantity, requireBlock, type BlockRef } from "./evm.js";

export type { BlockRef } from "./evm.js";

export interface ProjectionConfig {
  readonly chainId: number;
  /** Lowercase collection address. */
  readonly collection: string;
  /** The adapter's deployment block. No Chog can be bound earlier, so earlier transfers never matter. */
  readonly activation: BlockRef;
}

export interface TransferRecord {
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly logIndex: number;
  readonly transactionHash: string;
  readonly tokenId: string;
  readonly from: string;
  readonly to: string;
}

export interface ProjectionHead {
  /** Highest indexed block: every Transfer log up to and including it is stored. */
  readonly cursor: BlockRef;
  /** Advances on every rewind, so observations from before a reorg can be told apart. */
  readonly generation: bigint;
  /** Retained checkpoints, oldest first. Always holds the activation block and the cursor. */
  readonly checkpoints: readonly BlockRef[];
}

export interface TokenProjection {
  readonly cursor: BlockRef;
  readonly generation: bigint;
  /** Transfer logs of the token on the canonical chain since activation. */
  readonly canonicalTransfers: number;
  /** Transfer logs of the token that a reorg removed. */
  readonly orphanedTransfers: number;
  /** The token's latest canonical transfer, or null if it has not moved since activation. */
  readonly latest: TransferRecord | null;
}

export type ProjectionUpdate =
  | { readonly kind: "advance"; readonly to: BlockRef; readonly transfers: readonly TransferRecord[] }
  | { readonly kind: "rewind"; readonly to: BlockRef };

/**
 * Durable projection state. `apply` is compare-and-set on the expected cursor and generation, so two
 * processes indexing the same collection never interleave; it returns null when the head moved.
 */
export interface ProjectionStore {
  /** Loads the projection, creating it at the activation block the first time. */
  open(config: ProjectionConfig): Promise<ProjectionHead>;
  apply(config: ProjectionConfig, expected: ProjectionHead, update: ProjectionUpdate, retainCheckpoints: number): Promise<ProjectionHead | null>;
  /** One consistent read of the head and a token's transfer history. */
  token(config: ProjectionConfig, tokenId: string): Promise<TokenProjection>;
}

export function projectionScope(config: ProjectionConfig): string {
  return `${config.chainId}:${config.collection}:${config.activation.number}`;
}

/**
 * Starts at 1 and advances on every Transfer of the token, including A→B→A. A transfer that a reorg
 * removes counts twice more: once for the reversal it caused, once so that a rebuilt history can never
 * repeat an epoch an earlier owner held. The epoch therefore only grows.
 */
export function ownershipEpoch(token: Pick<TokenProjection, "canonicalTransfers" | "orphanedTransfers">): string {
  return String(1 + token.canonicalTransfers + 2 * token.orphanedTransfers);
}

export type UnavailableReason = "rpc" | "indexer_lag" | "reorg";

/** The projection could not produce a canonical answer; the reason maps onto `unavailable`. */
export class ProjectionError extends Error {
  override readonly name = "ProjectionError";
  constructor(message: string, readonly reason: UnavailableReason) {
    super(message);
  }
}

export function unavailableReason(error: unknown): UnavailableReason {
  if (error instanceof ProjectionError) return error.reason;
  if (error instanceof RpcError || error instanceof MalformedRpcResult) return "rpc";
  // Anything else (for example the database) means the projection cannot be trusted right now.
  return "indexer_lag";
}

export interface SyncResult {
  readonly head: ProjectionHead;
  /** The finalized head this pass indexed towards, and when it was read. */
  readonly target: BlockRef;
  readonly observedAtMs: number;
  /** True when the projection reached the target. */
  readonly caughtUp: boolean;
}

export interface TransferProjectionOptions {
  readonly rpc: JsonRpc;
  readonly store: ProjectionStore;
  readonly config: ProjectionConfig;
  /** Blocks per eth_getLogs request. Monad's public RPCs allow 100. */
  readonly chunkBlocks?: number;
  /** Windows per pass, so one pass stays short while catching up. */
  readonly maxChunksPerPass?: number;
  /**
   * eth_getLogs requests sent at once, each covering `chunkBlocks`. Their window is checked and stored as one
   * range, exactly as one larger chunk would be. Default 1: one request at a time.
   */
  readonly parallelRequests?: number;
  /** Checkpoints kept for reorg recovery, besides the activation block. */
  readonly retainCheckpoints?: number;
  readonly now?: () => number;
  /** Called once per failed pass and per reorg rewind. */
  readonly onEvent?: (event: ProjectionEvent) => void;
}

export type ProjectionEvent =
  | { readonly kind: "pass_failed"; readonly error: unknown }
  | { readonly kind: "rewound"; readonly from: BlockRef; readonly to: BlockRef; readonly generation: bigint };

function parseTransfers(raw: unknown, config: ProjectionConfig, from: bigint, to: BlockRef): TransferRecord[] {
  if (!Array.isArray(raw)) throw new MalformedRpcResult("eth_getLogs returned something other than a list.");
  const transfers = raw.map((value, index): TransferRecord => {
    const log = (value ?? {}) as { address?: unknown; topics?: unknown; blockNumber?: unknown; blockHash?: unknown; logIndex?: unknown; transactionHash?: unknown; removed?: unknown };
    const label = `Log ${index} in blocks ${from}-${to.number}`;
    if (parseAddress(log.address, `${label} address`) !== config.collection) throw new MalformedRpcResult(`${label} is not from the collection.`);
    if (log.removed === true) throw new MalformedRpcResult(`${label} is marked removed.`);
    const topics = Array.isArray(log.topics) ? log.topics.map((topic, i) => parseHash(topic, `${label} topic ${i}`)) : [];
    // An ERC-721 Transfer has three indexed arguments. Anything else from this collection is unexpected.
    if (topics.length !== 4 || topics[0] !== TRANSFER_TOPIC) throw new MalformedRpcResult(`${label} is not an ERC-721 Transfer.`);
    const blockNumber = parseQuantity(log.blockNumber, `${label} block number`);
    if (blockNumber < from || blockNumber > to.number) throw new MalformedRpcResult(`${label} is outside the requested blocks.`);
    const blockHash = parseHash(log.blockHash, `${label} block hash`);
    if (blockNumber === to.number && blockHash !== to.hash) throw new ProjectionError(`${label} belongs to a different block ${to.number}.`, "reorg");
    const logIndex = parseQuantity(log.logIndex, `${label} index`);
    const address = (topic: string, name: string) => {
      if (!topic.startsWith("0x000000000000000000000000")) throw new MalformedRpcResult(`${label} ${name} is not an address.`);
      return `0x${topic.slice(26)}`;
    };
    return {
      blockNumber, blockHash, logIndex: Number(logIndex), transactionHash: parseHash(log.transactionHash, `${label} transaction`),
      tokenId: BigInt(topics[3]!).toString(), from: address(topics[1]!, "from"), to: address(topics[2]!, "to"),
    };
  });
  transfers.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  for (let i = 1; i < transfers.length; i++) {
    const [previous, current] = [transfers[i - 1]!, transfers[i]!];
    if (previous.blockNumber === current.blockNumber && (previous.logIndex === current.logIndex || previous.blockHash !== current.blockHash)) {
      throw new MalformedRpcResult(`eth_getLogs returned conflicting logs for block ${current.blockNumber}.`);
    }
  }
  return transfers;
}

/**
 * Keeps the projection in step with the finalized head. Each window (one chunk, or `parallelRequests` chunks read
 * at once) reads block `to`, then its logs, then `to` and the cursor again: logs are stored only if `to` did not
 * change while they were read and the cursor is still canonical, so a stored range always extends the stored chain.
 */
export class TransferProjection {
  readonly #rpc: JsonRpc;
  readonly #store: ProjectionStore;
  readonly #config: ProjectionConfig;
  readonly #chunkBlocks: bigint;
  readonly #parallel: number;
  readonly #maxChunks: number;
  readonly #retain: number;
  readonly #now: () => number;
  readonly #onEvent: (event: ProjectionEvent) => void;
  #head: ProjectionHead | undefined;
  #inflight: Promise<SyncResult> | undefined;
  #last: SyncResult | undefined;

  constructor(options: TransferProjectionOptions) {
    const chunk = options.chunkBlocks ?? 100;
    if (!Number.isInteger(chunk) || chunk < 1) throw new Error("chunkBlocks must be a positive integer.");
    const parallel = options.parallelRequests ?? 1;
    if (!Number.isInteger(parallel) || parallel < 1) throw new Error("parallelRequests must be a positive integer.");
    this.#rpc = options.rpc;
    this.#store = options.store;
    this.#config = options.config;
    this.#chunkBlocks = BigInt(chunk);
    this.#parallel = parallel;
    this.#maxChunks = options.maxChunksPerPass ?? 25;
    this.#retain = options.retainCheckpoints ?? 64;
    this.#now = options.now ?? Date.now;
    this.#onEvent = options.onEvent ?? (() => {});
  }

  get config(): ProjectionConfig { return this.#config; }

  /** Runs one pass, or joins the pass already running. */
  sync(): Promise<SyncResult> {
    this.#inflight ??= this.#pass().then(
      (result) => { this.#last = result; return result; },
      (error: unknown) => { this.#onEvent({ kind: "pass_failed", error }); throw error; },
    ).finally(() => { this.#inflight = undefined; });
    return this.#inflight;
  }

  /** The last caught-up pass if it read the head within `maxAgeMs`, otherwise a new pass. */
  async fresh(maxAgeMs: number): Promise<SyncResult> {
    const last = this.#last;
    if (last?.caughtUp && this.#now() - last.observedAtMs <= maxAgeMs) return last;
    return this.sync();
  }

  async #pass(): Promise<SyncResult> {
    let head = this.#head ?? await this.#store.open(this.#config);
    this.#head = head;
    const observedAtMs = this.#now();
    const target = await requireBlock(this.#rpc, "finalized");
    let steps = 0;
    for (;;) {
      if (head.cursor.number >= target.number) {
        // A lagging load-balanced node can report an older finalized block than one already indexed, and a
        // reorg can shorten the chain. Only the cursor's own hash tells them apart.
        const current = head.cursor.number === target.number ? target : await requireBlock(this.#rpc, head.cursor.number);
        if (current.hash === head.cursor.hash) return { head, target, observedAtMs, caughtUp: true };
        head = await this.#rewind(head);
        steps += 1;
        continue;
      }
      if (steps >= this.#maxChunks) return { head, target, observedAtMs, caughtUp: false };
      steps += 1;
      const from = head.cursor.number + 1n;
      const span = this.#chunkBlocks * BigInt(this.#parallel);
      const end = head.cursor.number + span < target.number ? head.cursor.number + span : target.number;
      const before = await requireBlock(this.#rpc, end);
      const ranges: [bigint, bigint][] = [];
      for (let start = from; start <= end; start += this.#chunkBlocks) {
        ranges.push([start, start + this.#chunkBlocks - 1n < end ? start + this.#chunkBlocks - 1n : end]);
      }
      const parts = await Promise.all(ranges.map(([start, stop]) => this.#rpc.request("eth_getLogs", [
        { address: this.#config.collection, topics: [TRANSFER_TOPIC], fromBlock: quantity(start), toBlock: quantity(stop) },
      ])));
      if (!parts.every(Array.isArray)) throw new MalformedRpcResult("eth_getLogs returned something other than a list.");
      const logs = parts.flat();
      const [after, cursorNow] = await Promise.all([requireBlock(this.#rpc, end), requireBlock(this.#rpc, head.cursor.number)]);
      if (cursorNow.hash !== head.cursor.hash) { head = await this.#rewind(head); continue; }
      if (after.hash !== before.hash) throw new ProjectionError(`Block ${end} changed while its logs were read.`, "reorg");
      const transfers = parseTransfers(logs, this.#config, from, after);
      const next = await this.#store.apply(this.#config, head, { kind: "advance", to: after, transfers }, this.#retain);
      head = next ?? await this.#store.open(this.#config);
      this.#head = head;
    }
  }

  /** Moves the cursor back to the newest retained checkpoint that is still canonical. */
  async #rewind(head: ProjectionHead): Promise<ProjectionHead> {
    let ancestor: BlockRef | undefined;
    for (const checkpoint of [...head.checkpoints].reverse()) {
      if (checkpoint.number >= head.cursor.number) continue;
      const current = await getBlock(this.#rpc, checkpoint.number);
      // A missing block is a node problem, not evidence of a reorg.
      if (!current) throw new MalformedRpcResult(`The RPC node does not have block ${checkpoint.number}.`);
      if (current.hash === checkpoint.hash) { ancestor = checkpoint; break; }
    }
    if (!ancestor) {
      throw new ProjectionError(`The activation block ${this.#config.activation.number} is no longer canonical; re-verify the deployment manifest.`, "reorg");
    }
    const next = await this.#store.apply(this.#config, head, { kind: "rewind", to: ancestor }, this.#retain);
    if (!next) {
      const reloaded = await this.#store.open(this.#config);
      this.#head = reloaded;
      return reloaded;
    }
    this.#head = next;
    this.#last = undefined;
    this.#onEvent({ kind: "rewound", from: head.cursor, to: ancestor, generation: next.generation });
    return next;
  }
}

/** In-process store, for tests and tools. Same semantics as the PostgreSQL store. */
export class MemoryProjectionStore implements ProjectionStore {
  readonly #states = new Map<string, { head: ProjectionHead; transfers: (TransferRecord & { orphanedGeneration: bigint | null })[] }>();

  #state(config: ProjectionConfig) {
    const state = this.#states.get(projectionScope(config));
    if (!state) throw new Error("Projection is not open.");
    return state;
  }

  async open(config: ProjectionConfig): Promise<ProjectionHead> {
    const scope = projectionScope(config);
    let state = this.#states.get(scope);
    if (!state) {
      state = { head: { cursor: config.activation, generation: 1n, checkpoints: [config.activation] }, transfers: [] };
      this.#states.set(scope, state);
    }
    if (state.head.checkpoints[0]!.hash !== config.activation.hash) throw new Error("The stored projection was built from a different activation block.");
    return state.head;
  }

  async apply(config: ProjectionConfig, expected: ProjectionHead, update: ProjectionUpdate, retain: number): Promise<ProjectionHead | null> {
    const state = this.#state(config);
    const { head } = state;
    if (head.cursor.number !== expected.cursor.number || head.cursor.hash !== expected.cursor.hash || head.generation !== expected.generation) return null;
    if (update.kind === "advance") {
      if (update.to.number <= head.cursor.number) throw new Error("An advance must move the cursor forward.");
      for (const transfer of update.transfers) {
        if (transfer.blockNumber <= head.cursor.number || transfer.blockNumber > update.to.number) throw new Error("Transfer outside the advanced range.");
        state.transfers.push({ ...transfer, orphanedGeneration: null });
      }
      const [activation, ...rest] = head.checkpoints;
      state.head = { cursor: update.to, generation: head.generation, checkpoints: [activation!, ...[...rest, update.to].slice(-retain)] };
    } else {
      if (!head.checkpoints.some((checkpoint) => checkpoint.number === update.to.number && checkpoint.hash === update.to.hash)) throw new Error("A rewind must target a retained checkpoint.");
      const generation = head.generation + 1n;
      for (const transfer of state.transfers) {
        if (transfer.orphanedGeneration === null && transfer.blockNumber > update.to.number) transfer.orphanedGeneration = generation;
      }
      state.head = { cursor: update.to, generation, checkpoints: head.checkpoints.filter((checkpoint) => checkpoint.number <= update.to.number) };
    }
    return state.head;
  }

  async token(config: ProjectionConfig, tokenId: string): Promise<TokenProjection> {
    const state = this.#state(config);
    const mine = state.transfers.filter((transfer) => transfer.tokenId === tokenId);
    const canonical = mine.filter((transfer) => transfer.orphanedGeneration === null);
    const latest = canonical.reduce<(typeof canonical)[number] | undefined>((best, transfer) =>
      !best || transfer.blockNumber > best.blockNumber || (transfer.blockNumber === best.blockNumber && transfer.logIndex > best.logIndex) ? transfer : best, undefined);
    return {
      cursor: state.head.cursor, generation: state.head.generation,
      canonicalTransfers: canonical.length, orphanedTransfers: mine.length - canonical.length,
      latest: latest ? { blockNumber: latest.blockNumber, blockHash: latest.blockHash, logIndex: latest.logIndex, transactionHash: latest.transactionHash, tokenId: latest.tokenId, from: latest.from, to: latest.to } : null,
    };
  }
}
