// Which agent a Chog Genesis token was awakened as. A holder bringing a Chog into City names only its token;
// the agent ID comes from the verified adapter's agentOf, never from the client.
import type { AgentIdentity } from "../shared/identity.js";
import type { Traits } from "../engine/types.js";
import { ADAPTER, MalformedRpcResult, parseHex, requireBlock } from "./evm.js";
import type { LiveDeployment } from "./liveChainReader.js";
import { RpcError, type JsonRpc } from "./rpc.js";

export type AgentLookup =
  | { readonly kind: "awakened"; readonly identity: AgentIdentity; readonly name: string; readonly traits: Traits }
  | { readonly kind: "not_awakened" }
  | { readonly kind: "unavailable" };

export interface AgentDirectory {
  lookup(tokenId: string): Promise<AgentLookup>;
}

const CALL_GAS = "0x186a0";
const NOT_AWAKENED = ADAPTER.getError("NotAwakened")!.selector;

export interface LiveAgentDirectoryOptions {
  readonly rpc: JsonRpc;
  readonly deployment: LiveDeployment;
  /** The token's traits (for the Cult persona and decrees); none when omitted. */
  readonly traitsOf?: (tokenId: string) => Traits;
  /** RPC failures; messages carry no RPC URL. */
  readonly onError?: (error: unknown) => void;
}

/** Reads agentOf at the finalized block. Only the adapter's own NotAwakened revert means "not awakened". */
export class LiveAgentDirectory implements AgentDirectory {
  readonly #rpc: JsonRpc;
  readonly #deployment: LiveDeployment;
  readonly #onError: (error: unknown) => void;
  readonly #traitsOf: (tokenId: string) => Traits;

  constructor(options: LiveAgentDirectoryOptions) {
    this.#rpc = options.rpc;
    this.#deployment = options.deployment;
    this.#traitsOf = options.traitsOf ?? (() => ({}));
    this.#onError = options.onError ?? (() => {});
  }

  async lookup(tokenId: string): Promise<AgentLookup> {
    let raw: string;
    try {
      const at = await requireBlock(this.#rpc, "finalized");
      raw = parseHex(await this.#rpc.request("eth_call", [
        { to: this.#deployment.adapter, data: ADAPTER.encodeFunctionData("agentOf", [BigInt(tokenId)]), gas: CALL_GAS },
        { blockHash: at.hash, requireCanonical: true },
      ]), "eth_call result");
    } catch (error) {
      if (error instanceof RpcError && error.failure === "reverted" && error.data?.toLowerCase().startsWith(NOT_AWAKENED)) return { kind: "not_awakened" };
      this.#onError(error);
      return { kind: "unavailable" };
    }
    let agentId: bigint;
    try { agentId = BigInt(ADAPTER.decodeFunctionResult("agentOf", raw)[0]); } catch {
      this.#onError(new MalformedRpcResult(`agentOf(${tokenId}) returned malformed data.`));
      return { kind: "unavailable" };
    }
    const d = this.#deployment;
    return {
      kind: "awakened", name: `Chog #${tokenId}`, traits: this.#traitsOf(tokenId),
      identity: { chainId: d.chainId, registry: d.registry, adapter: d.adapter, collection: d.collection, tokenId, agentId: agentId.toString() },
    };
  }
}
