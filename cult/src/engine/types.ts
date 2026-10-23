import type { AgentKey } from "../shared/identity.js";
import type { FactionId, Place, Stance } from "../rules.js";

/** NFT metadata traits keyed by trait type, as in the collection metadata (for example { Head: "Crown" }). */
export type Traits = Readonly<Record<string, string>>;

export interface FactionSpan {
  readonly faction: FactionId;
  readonly fromCycle: number;
  /** Cycle in which membership ended, or null while it continues. */
  readonly toCycle: number | null;
}

export interface Member {
  readonly agentKey: AgentKey;
  readonly faction: FactionId | null;
  readonly stance: Stance;
  /** Cycle in which the Chog joined its current faction; it votes from the next cycle on. */
  readonly joinedCycle: number | null;
  readonly lastSwitchCycle: number | null;
  readonly ownershipEpoch: string;
  readonly traits: Traits;
  /** Public faction history; kept across transfers. */
  readonly history: readonly FactionSpan[];
}

/** Control as observed for the tally: only `verified` members take part. */
export type ControlStatus = "verified" | "unavailable" | "burned" | "not_awakened";

export interface MemberAtTally extends Member {
  readonly control: ControlStatus;
}

export interface VoteRecord {
  readonly cycle: number;
  readonly agentKey: AgentKey;
  readonly place: Place;
  readonly faction: FactionId;
  /** null records a holder's explicit abstention for this place. */
  readonly decreeId: string | null;
  readonly source: "agent" | "holder";
  readonly ownershipEpoch: string;
}

export interface PresenceRecord {
  readonly cycle: number;
  readonly agentKey: AgentKey;
  readonly place: Place;
  readonly points: number;
  /** City public revision that produced the points; the same revision never counts twice. */
  readonly cityRevision: string;
}

export interface PlaceControl {
  readonly faction: FactionId;
  readonly decreeId: string;
  readonly sinceCycle: number;
}

export interface Reputation {
  readonly loyalty: number;
  readonly glory: number;
}

export interface CycleInput {
  readonly rulesVersion: string;
  readonly cycle: number;
  readonly members: readonly MemberAtTally[];
  readonly votes: readonly VoteRecord[];
  readonly presence: readonly PresenceRecord[];
  readonly control: Readonly<Record<Place, PlaceControl | null>>;
  readonly reputation: Readonly<Record<string, Reputation>>;
}

export type Outcome = "won" | "tie_held" | "tie_neutral" | "no_contest";

export interface FactionInfluence {
  readonly votes: number;
  readonly presence: number;
  readonly total: number;
}

export interface PlaceResult {
  readonly influence: Readonly<Record<FactionId, FactionInfluence>>;
  readonly decreeVotes: Readonly<Record<string, number>>;
  readonly outcome: Outcome;
  readonly control: PlaceControl | null;
}

export type RejectReason = "wrong_cycle" | "unknown_member" | "not_eligible" | "faction_mismatch" | "epoch_changed" | "stance_abstain" | "invalid_decree";

export interface CycleResult {
  readonly rulesVersion: string;
  readonly cycle: number;
  readonly places: Readonly<Record<Place, PlaceResult>>;
  readonly countedVotes: readonly VoteRecord[];
  readonly rejectedVotes: readonly { readonly vote: VoteRecord; readonly reason: RejectReason }[];
  readonly reputation: Readonly<Record<string, Reputation>>;
  readonly reputationDeltas: Readonly<Record<string, Reputation>>;
}

export type CultErrorCode = "SWITCH_COOLDOWN" | "NOT_ELIGIBLE" | "VOTING_CLOSED" | "INVALID_INPUT" | "NOT_CONTROLLER" | "OWNERSHIP_UNAVAILABLE" | "CONTROL_CHANGED" | "IDEMPOTENCY_CONFLICT";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: CultErrorCode; readonly message: string };
