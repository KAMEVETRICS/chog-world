import type { EventDto, MemberDto, SnapshotDto } from "../../src/api/readModel";
import type { FactionId, Place, Stance } from "../../src/rules";

export type { EventDto, MemberDto, SnapshotDto };

export interface SiteConfig {
  readonly mode: "fixture" | "live";
  readonly label: string;
  readonly chainIds: readonly number[];
  readonly login: boolean;
  readonly city?: boolean;
}

export interface MyChog {
  readonly agentKey: string;
  readonly name: string;
  readonly faction: FactionId | null;
  readonly stance: Stance;
  readonly joinedCycle: number | null;
  readonly ownershipEpoch: string;
  readonly control: string;
}

export interface Me {
  readonly address: string;
  readonly chainId: number;
  readonly expiresAt: string;
  readonly chogs: readonly MyChog[];
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...init, headers: { ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(response.status, error?.code ?? "NETWORK", error?.message ?? `Request failed (${response.status}).`);
  }
  return body as T;
}

export function guarded(csrf: string): Record<string, string> {
  return { "x-csrf-token": csrf, "idempotency-key": crypto.randomUUID() };
}

export const api = {
  config: () => call<SiteConfig>("/api/cult/config"),
  snapshot: () => call<SnapshotDto>("/api/cult/snapshot"),
  async me(): Promise<Me | null> {
    try { return await call<Me>("/api/me"); }
    catch (error) { if (error instanceof ApiError && error.status === 401) return null; throw error; }
  },
  challenge: (address: string, chainId: number) => call<{ message: string }>("/api/auth/challenge", { method: "POST", body: JSON.stringify({ address, chainId }) }),
  verify: (message: string, signature: string) => call<{ address: string; csrfToken: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ message, signature }) }),
  logout: (csrf: string) => call<{ loggedOut: true }>("/api/auth/logout", { method: "POST", headers: { "x-csrf-token": csrf } }),
  setMembership: (csrf: string, agentKey: string, change: { faction?: FactionId | null; stance?: Stance; expectedEpoch: string }) =>
    call<{ member: unknown }>(`/api/cult/members/${agentKey}`, { method: "PUT", body: JSON.stringify(change), headers: guarded(csrf) }),
  vote: (csrf: string, cycle: number, agentKey: string, place: Place, decreeId: string | null, expectedEpoch: string) =>
    call<{ vote: unknown }>(`/api/cult/votes/${cycle}/${agentKey}/${place}`, { method: "PUT", body: JSON.stringify({ decreeId, expectedEpoch }), headers: guarded(csrf) }),
};

export const EVENT_TYPES = [
  "phase_changed", "debate", "votes_cast", "override", "member_changed", "control_changed",
  "city_gap", "city_late", "schedule_gap", "place_control_changed", "cycle_resolved",
] as const;
