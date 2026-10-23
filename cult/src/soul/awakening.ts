// Awakening a Chog: the transaction its holder sends from their own wallet. The ERC-8004 registration file goes
// on chain inside the transaction as a data: URI, so the agent's record never depends on this server or its
// domain. The server only prepares the call; it never signs or sends anything.
import { ADAPTER } from "../chain/evm.js";
import { genesisImageIpfs } from "../citysim/world.js";

export const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

/** The registration file for an awakened Chog Genesis token (ERC-8004 registration-v1). */
export function registrationFile(tokenId: string): Record<string, string> {
  const image = genesisImageIpfs(tokenId);
  return {
    type: REGISTRATION_TYPE,
    name: `Chog #${tokenId}`,
    description: `Chog Genesis #${tokenId}, awakened on Monad. It lives in Chog City, argues in Chog Cult and speaks through Chog Soul. Whoever holds the NFT controls the agent.`,
    ...(image ? { image } : {}),
  };
}

export function agentURIFor(tokenId: string): string {
  return `data:application/json;base64,${Buffer.from(JSON.stringify(registrationFile(tokenId)), "utf8").toString("base64")}`;
}

export interface AwakenPlan {
  readonly chainId: number;
  /** The ChogAdapter. */
  readonly to: string;
  /** awaken(tokenId, agentURI) */
  readonly data: string;
  readonly agentURI: string;
}

export function awakenPlan(deployment: { readonly chainId: number; readonly adapter: string }, tokenId: string): AwakenPlan {
  const agentURI = agentURIFor(tokenId);
  return { chainId: deployment.chainId, to: deployment.adapter, data: ADAPTER.encodeFunctionData("awaken", [BigInt(tokenId), agentURI]), agentURI };
}
