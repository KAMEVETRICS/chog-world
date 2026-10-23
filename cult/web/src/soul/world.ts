import { call, guarded } from "../api";

/** One Chog Genesis token the signed-in wallet holds, and where it is in Chog World. */
export interface SoulChog {
  readonly tokenId: string;
  readonly name: string;
  readonly image: string | null;
  readonly awakened: boolean;
  readonly agentKey: string | null;
  readonly inCult: boolean;
  readonly inCity: boolean;
  readonly plotId: string | null;
}

export interface Holdings {
  readonly address: string;
  readonly blockNumber: string;
  /** False on a server that can't send awakenings (the local fixture). */
  readonly awakening: boolean;
  readonly chogs: readonly SoulChog[];
}

/** The transaction that awakens a Chog: the holder's own wallet sends it. */
export interface AwakenPlan {
  readonly chainId: number;
  readonly to: string;
  readonly data: string;
  readonly agentURI: string;
}

export const worldApi = {
  holdings: () => call<Holdings>("/api/soul/holdings"),
  token: (tokenId: string) => call<{ tokenId: string; awakened: boolean; agentKey: string | null }>(`/api/soul/tokens/${tokenId}`),
  plan: (tokenId: string) => call<AwakenPlan>(`/api/soul/awaken/${tokenId}`),
  /** Moves an awakened Chog into City (when a plot is free) and the Cult and its Soul. */
  join: (csrf: string, tokenId: string) =>
    call<{ agent: unknown }>("/api/city/admissions", { method: "POST", body: JSON.stringify({ tokenId }), headers: guarded(csrf) }),
};
