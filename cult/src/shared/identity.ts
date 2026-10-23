// Copied from the Chog City design (docs/superpowers/specs/2026-10-19-chog-city-design.md, section 6)
// so both packages agree on identity and control. Move to a shared library once City publishes one.

export type ChainId = 31337 | 10143 | 143;

export interface AgentIdentity {
  chainId: ChainId;
  registry: string;
  adapter: string;
  collection: string;
  tokenId: string;
  agentId: string;
}

declare const agentKeyBrand: unique symbol;
/** chainId:registry:adapter:collection:tokenId:agentId, built only by makeAgentKey. */
export type AgentKey = string & { readonly [agentKeyBrand]: true };

const UINT256_MAX = (1n << 256n) - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;

function canonicalUint256(value: string, label: string): string {
  if (!DECIMAL.test(value) || BigInt(value) > UINT256_MAX) throw new Error(`${label} must be a canonical uint256 decimal string.`);
  return value;
}

function canonicalAddress(value: string, label: string): string {
  if (!ADDRESS.test(value)) throw new Error(`${label} must be a 20-byte hex address.`);
  return value.toLowerCase();
}

export function makeAgentKey(identity: AgentIdentity): AgentKey {
  if (![31337, 10143, 143].includes(identity.chainId)) throw new Error("Unsupported chain ID.");
  return [
    identity.chainId,
    canonicalAddress(identity.registry, "registry"),
    canonicalAddress(identity.adapter, "adapter"),
    canonicalAddress(identity.collection, "collection"),
    canonicalUint256(identity.tokenId, "tokenId"),
    canonicalUint256(identity.agentId, "agentId"),
  ].join(":") as AgentKey;
}

export type ControlObservation =
  | { kind: "controlled"; controller: string; ownershipEpoch: string; blockNumber: string; blockHash: string; observedAtMs: number; projectionGeneration: string }
  | { kind: "burned" | "not_awakened"; ownershipEpoch: string; blockNumber: string; blockHash: string; observedAtMs: number; projectionGeneration: string }
  | { kind: "unavailable"; reason: "rpc" | "indexer_lag" | "reorg" };

export interface ChainReader {
  resolveAgent(identity: AgentIdentity): Promise<ControlObservation>;
}
