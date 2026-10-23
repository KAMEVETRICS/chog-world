// Live ownership for Monad: resolves an AgentIdentity against the verified ChogAdapter and the
// collection's Transfer-log projection. Every answer describes one finalized block: the projection's
// cursor, and adapter calls pinned to that block's hash. Failures give `unavailable`, never a guess.
import { makeAgentKey, type AgentIdentity, type ChainId, type ChainReader, type ControlObservation } from "../shared/identity.js";
import { ADAPTER, MalformedRpcResult, ZERO_ADDRESS, parseAddress, parseHex, type BlockRef } from "./evm.js";
import { ProjectionError, TransferProjection, ownershipEpoch, unavailableReason, type ProjectionStore, type SyncResult, type TokenProjection } from "./projection.js";
import { RpcError, type JsonRpc } from "./rpc.js";

/** The contracts a verified manifest pins (src/chain/manifest.ts). Addresses are lowercase. */
export interface LiveDeployment {
  readonly chainId: ChainId;
  readonly registry: string;
  readonly adapter: string;
  readonly collection: string;
  /** The adapter's deployment block: the projection starts here. */
  readonly activation: BlockRef;
}

export interface LiveChainReaderOptions {
  readonly rpc: JsonRpc;
  readonly store: ProjectionStore;
  readonly deployment: LiveDeployment;
  /** Whole budget for one resolveAgent call (City design: 8 seconds for live dependencies). */
  readonly budgetMs?: number;
  /** A projection pass that read the finalized head this recently is reused instead of starting another. */
  readonly maxAgeMs?: number;
  /** Delay between follow passes once caught up (`start`). */
  readonly pollMs?: number;
  readonly chunkBlocks?: number;
  readonly maxChunksPerPass?: number;
  /** eth_getLogs requests sent at once while catching up (see TransferProjection). */
  readonly parallelRequests?: number;
  readonly retainCheckpoints?: number;
  readonly now?: () => number;
  /** Failed projection passes, reorgs and per-Chog read failures. Messages carry no RPC URL. */
  readonly onError?: (error: unknown) => void;
}

class DeadlineExceeded extends Error {
  override readonly name = "DeadlineExceeded";
}

// Some public RPCs reject eth_call without an explicit gas allowance; these views are cheap.
const CALL_GAS = "0x186a0";
const ERC721 = 0n;
const UNKNOWN_AGENT = ADAPTER.getError("UnknownAgent")!.selector;

type Evidence = { ownershipEpoch: string; blockNumber: string; blockHash: string; observedAtMs: number; projectionGeneration: string };
type Binding = { readonly kind: "bound"; readonly standard: bigint; readonly tokenContract: string; readonly tokenId: string } | { readonly kind: "unknown" };

export class LiveChainReader implements ChainReader {
  readonly #rpc: JsonRpc;
  readonly #store: ProjectionStore;
  readonly #deployment: LiveDeployment;
  readonly #projection: TransferProjection;
  readonly #budgetMs: number;
  readonly #maxAgeMs: number;
  readonly #pollMs: number;
  readonly #onError: (error: unknown) => void;
  /** Bindings never change once made, unless a reorg undoes the awakening: cached per generation. */
  readonly #bindings = new Map<string, { generation: bigint; binding: Binding & { kind: "bound" } }>();
  #stopped = true;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(options: LiveChainReaderOptions) {
    const { deployment } = options;
    this.#rpc = options.rpc;
    this.#store = options.store;
    this.#deployment = {
      chainId: deployment.chainId, registry: deployment.registry.toLowerCase(), adapter: deployment.adapter.toLowerCase(),
      collection: deployment.collection.toLowerCase(), activation: deployment.activation,
    };
    this.#budgetMs = options.budgetMs ?? 8_000;
    this.#maxAgeMs = options.maxAgeMs ?? 1_500;
    this.#pollMs = options.pollMs ?? 1_000;
    this.#onError = options.onError ?? (() => {});
    this.#projection = new TransferProjection({
      rpc: options.rpc, store: options.store,
      config: { chainId: deployment.chainId, collection: this.#deployment.collection, activation: deployment.activation },
      ...(options.chunkBlocks === undefined ? {} : { chunkBlocks: options.chunkBlocks }),
      ...(options.maxChunksPerPass === undefined ? {} : { maxChunksPerPass: options.maxChunksPerPass }),
      ...(options.parallelRequests === undefined ? {} : { parallelRequests: options.parallelRequests }),
      ...(options.retainCheckpoints === undefined ? {} : { retainCheckpoints: options.retainCheckpoints }),
      ...(options.now === undefined ? {} : { now: options.now }),
      onEvent: (event) => {
        if (event.kind === "pass_failed") this.#onError(event.error);
        else this.#onError(new ProjectionError(`Chain reorganized: projection rewound from block ${event.from.number} to ${event.to.number} (generation ${event.generation}).`, "reorg"));
      },
    });
  }

  /**
   * Runs projection passes until it reaches the finalized head. For startup, before serving. Progress is
   * stored after every chunk, so a few failed passes are retried; the fifth failure in a row is thrown.
   */
  async catchUp(onProgress?: (result: SyncResult) => void, retryMs = 1_000): Promise<SyncResult> {
    for (let failures = 0; ;) {
      let result: SyncResult;
      try {
        result = await this.#projection.sync();
        failures = 0;
      } catch (error) {
        if (++failures >= 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryMs * failures));
        continue;
      }
      onProgress?.(result);
      if (result.caughtUp) return result;
    }
  }

  /** Keeps the projection following the finalized head in the background. */
  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#loop = this.#follow();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();
    await this.#loop;
  }

  async #follow(): Promise<void> {
    let failures = 0;
    while (!this.#stopped) {
      let delay = this.#pollMs;
      try {
        const result = await this.#projection.sync();
        failures = 0;
        if (!result.caughtUp) delay = 0;
      } catch {
        // Already reported through onError by the projection.
        failures += 1;
        delay = Math.min(this.#pollMs * 2 ** failures, 30_000);
      }
      if (this.#stopped) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delay);
        this.#wake = () => { clearTimeout(timer); resolve(); };
      });
    }
  }

  async resolveAgent(identity: AgentIdentity): Promise<ControlObservation> {
    this.#assertTrusted(identity);
    const stage = { current: "sync" as "sync" | "call" };
    let timer: NodeJS.Timeout | undefined;
    const work = this.#resolve(identity, stage);
    // The losing side of the race must not become an unhandled rejection.
    work.catch(() => {});
    try {
      return await Promise.race([work, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DeadlineExceeded(`Ownership of agent ${identity.agentId} was not resolved within ${this.#budgetMs}ms.`)), this.#budgetMs);
      })]);
    } catch (error) {
      if (error instanceof DeadlineExceeded) {
        if (stage.current === "call") this.#onError(error);
        return { kind: "unavailable", reason: stage.current === "sync" ? "indexer_lag" : "rpc" };
      }
      // Projection failures are reported once per pass; per-Chog failures here.
      if (stage.current === "call") this.#onError(error);
      return { kind: "unavailable", reason: unavailableReason(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Identities come from server-owned config; one from another deployment is a configuration error. */
  #assertTrusted(identity: AgentIdentity): void {
    makeAgentKey(identity);
    const d = this.#deployment;
    if (identity.chainId !== d.chainId || identity.registry.toLowerCase() !== d.registry || identity.adapter.toLowerCase() !== d.adapter || identity.collection.toLowerCase() !== d.collection) {
      throw new Error(`Agent ${identity.agentId} is not from the verified deployment (chain ${d.chainId}, adapter ${d.adapter}).`);
    }
  }

  async #resolve(identity: AgentIdentity, stage: { current: "sync" | "call" }): Promise<ControlObservation> {
    const synced = await this.#projection.fresh(this.#maxAgeMs);
    if (!synced.caughtUp) throw new ProjectionError(`The ownership projection is behind the finalized head (block ${synced.head.cursor.number} of ${synced.target.number}).`, "indexer_lag");
    stage.current = "call";
    const token = await this.#store.token(this.#projection.config, identity.tokenId);
    // Another process sharing the store may have advanced it (fine) or rewound it after a reorg.
    if (token.generation !== synced.head.generation || token.cursor.number < synced.head.cursor.number) {
      throw new ProjectionError("The ownership projection changed generation during this read.", "reorg");
    }
    const at = token.cursor;
    const evidence: Evidence = {
      ownershipEpoch: ownershipEpoch(token), blockNumber: at.number.toString(), blockHash: at.hash,
      observedAtMs: synced.observedAtMs, projectionGeneration: token.generation.toString(),
    };
    const binding = await this.#binding(identity.agentId, at, token.generation);
    if (binding.kind === "unknown") return { kind: "not_awakened", ...evidence };
    if (binding.standard !== ERC721 || binding.tokenContract !== this.#deployment.collection || binding.tokenId !== identity.tokenId) {
      this.#onError(new Error(`Agent ${identity.agentId} is bound to token ${binding.tokenId} of ${binding.tokenContract}, not token ${identity.tokenId}; treating it as not awakened.`));
      return { kind: "not_awakened", ...evidence };
    }
    const controller = await this.#controller(identity.agentId, at);
    return this.#classify(identity, controller, token, at, evidence);
  }

  #classify(identity: AgentIdentity, controller: string | null, token: TokenProjection, at: BlockRef, evidence: Evidence): ControlObservation {
    const latest = token.latest;
    if (controller === null) {
      // Burned only on canonical evidence: the token's latest indexed transfer went to the zero address.
      if (latest?.to === ZERO_ADDRESS) return { kind: "burned", ...evidence };
      throw new ProjectionError(`controllerOf(${identity.agentId}) has no owner at block ${at.number}, but the projection holds no burn of token ${identity.tokenId}.`, "rpc");
    }
    if (latest && latest.to !== controller) {
      throw new ProjectionError(`At block ${at.number} token ${identity.tokenId} is held by ${controller}, but its latest indexed transfer went to ${latest.to}.`, "indexer_lag");
    }
    return { kind: "controlled", controller, ...evidence };
  }

  async #call(data: string, at: BlockRef): Promise<string> {
    const result = await this.#rpc.request("eth_call", [{ to: this.#deployment.adapter, data, gas: CALL_GAS }, { blockHash: at.hash, requireCanonical: true }]);
    return parseHex(result, "eth_call result");
  }

  async #binding(agentId: string, at: BlockRef, generation: bigint): Promise<Binding> {
    const cached = this.#bindings.get(agentId);
    if (cached?.generation === generation) return cached.binding;
    let raw: string;
    try {
      raw = await this.#call(ADAPTER.encodeFunctionData("bindingOf", [BigInt(agentId)]), at);
    } catch (error) {
      if (error instanceof RpcError && error.failure === "reverted" && this.#isUnknownAgent(error.data, agentId)) return { kind: "unknown" };
      throw error;
    }
    let decoded;
    try { decoded = ADAPTER.decodeFunctionResult("bindingOf", raw)[0]; } catch { throw new MalformedRpcResult(`bindingOf(${agentId}) returned malformed data.`); }
    const binding = { kind: "bound" as const, standard: BigInt(decoded.standard), tokenContract: parseAddress(decoded.tokenContract, "Binding token contract"), tokenId: BigInt(decoded.tokenId).toString() };
    this.#bindings.set(agentId, { generation, binding });
    return binding;
  }

  #isUnknownAgent(data: string | undefined, agentId: string): boolean {
    if (!data?.toLowerCase().startsWith(UNKNOWN_AGENT)) return false;
    try { return BigInt(ADAPTER.decodeErrorResult("UnknownAgent", data)[0]) === BigInt(agentId); } catch { return false; }
  }

  /** The NFT holder at `at`, or null when the collection reports no owner (it reverted or said zero). */
  async #controller(agentId: string, at: BlockRef): Promise<string | null> {
    let raw: string;
    try {
      raw = await this.#call(ADAPTER.encodeFunctionData("controllerOf", [BigInt(agentId)]), at);
    } catch (error) {
      if (error instanceof RpcError && error.failure === "reverted") return null;
      throw error;
    }
    let owner: string;
    try { owner = parseAddress(ADAPTER.decodeFunctionResult("controllerOf", raw)[0], "controllerOf result"); } catch { throw new MalformedRpcResult(`controllerOf(${agentId}) returned malformed data.`); }
    return owner === ZERO_ADDRESS ? null : owner;
  }
}
