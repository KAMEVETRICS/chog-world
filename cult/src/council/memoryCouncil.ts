import type { AgentIdentity, AgentKey, ChainReader } from "../shared/identity.js";
import { PHASES, PLACES, RULES_VERSION, type FactionId, type Phase, type Place, type Stance } from "../rules.js";
import { presenceFromCity, type CityFeed } from "../city/feed.js";
import { debateLines, type DebateLine } from "../engine/debate.js";
import { applyTransfer, changeMembership, newMember } from "../engine/membership.js";
import { resolveCycle } from "../engine/resolveCycle.js";
import { castAgentVotes, holderOverride } from "../engine/votes.js";
import type { ControlStatus, CycleResult, Member, MemberAtTally, PlaceControl, PresenceRecord, Reputation, Result, Traits, VoteRecord } from "../engine/types.js";

export interface CouncilChog {
  readonly name: string;
  readonly identity: AgentIdentity;
  readonly agentKey: AgentKey;
  readonly traits: Traits;
}

export type CouncilEvent =
  | { readonly type: "phase_changed"; readonly cycle: number; readonly phase: Phase }
  | { readonly type: "member_changed"; readonly cycle: number; readonly agentKey: AgentKey; readonly faction: FactionId | null; readonly stance: Stance }
  | { readonly type: "control_changed"; readonly cycle: number; readonly agentKey: AgentKey; readonly status: ControlStatus; readonly ownershipEpoch: string }
  | { readonly type: "debate"; readonly cycle: number; readonly line: DebateLine }
  | { readonly type: "votes_cast"; readonly cycle: number; readonly votes: number }
  | { readonly type: "override"; readonly cycle: number; readonly agentKey: AgentKey; readonly place: Place; readonly decreeId: string | null }
  | { readonly type: "city_gap"; readonly cycle: number; readonly reason: string }
  | { readonly type: "city_late"; readonly cycle: number; readonly ignored: number }
  | { readonly type: "cycle_resolved"; readonly cycle: number; readonly result: CycleResult };

interface ControlState {
  status: ControlStatus;
  controller: string | null;
}

/**
 * In-memory council for fixtures and the demo: the same rules and checks the Postgres service will apply,
 * without persistence. Phases advance only when `advance()` is called; there is no clock here.
 */
export class MemoryCouncil {
  readonly #reader: ChainReader;
  readonly #feed: CityFeed;
  readonly #chogs: ReadonlyMap<AgentKey, CouncilChog>;
  readonly #members = new Map<AgentKey, Member>();
  readonly #control = new Map<AgentKey, ControlState>();
  readonly #results = new Map<number, CycleResult>();
  #cycle: number;
  #phase: Phase = "propose";
  #votes: VoteRecord[] = [];
  #placeControl: Record<Place, PlaceControl | null> = { plaza: null, tavern: null, workshop: null };
  #reputation: Record<string, Reputation> = {};
  #cityCursor = "0";
  readonly #now: () => number;
  #cycleStartMs = 0;
  readonly events: CouncilEvent[] = [];

  constructor(options: { reader: ChainReader; feed: CityFeed; chogs: readonly CouncilChog[]; now: () => number; startCycle?: number }) {
    this.#now = options.now;
    this.#reader = options.reader;
    this.#feed = options.feed;
    this.#chogs = new Map(options.chogs.map((chog) => [chog.agentKey, chog]));
    this.#cycle = options.startCycle ?? 0;
  }

  /** Reads ownership for every Chog; registers new ones and resets any that changed hands. */
  async start(): Promise<void> {
    this.#cycleStartMs = this.#now();
    for (const agentKey of this.#chogs.keys()) await this.#observe(agentKey);
    this.events.push({ type: "phase_changed", cycle: this.#cycle, phase: this.#phase });
  }

  get cycle(): number { return this.#cycle; }
  get phase(): Phase { return this.#phase; }
  get placeControl(): Readonly<Record<Place, PlaceControl | null>> { return this.#placeControl; }
  get reputation(): Readonly<Record<string, Reputation>> { return this.#reputation; }
  member(agentKey: AgentKey): Member | undefined { return this.#members.get(agentKey); }
  result(cycle: number): CycleResult | undefined { return this.#results.get(cycle); }
  currentVotes(): readonly VoteRecord[] { return this.#votes; }

  async #observe(agentKey: AgentKey): Promise<void> {
    const chog = this.#chogs.get(agentKey);
    if (!chog) throw new Error(`Unknown Chog ${agentKey}.`);
    const observation = await this.#reader.resolveAgent(chog.identity);
    const previous = this.#control.get(agentKey);
    if (observation.kind === "unavailable") {
      // An outage freezes the Chog; it never invents a transfer or a new epoch.
      this.#control.set(agentKey, { status: "unavailable", controller: previous?.controller ?? null });
      if (previous?.status !== "unavailable") this.events.push({ type: "control_changed", cycle: this.#cycle, agentKey, status: "unavailable", ownershipEpoch: this.#members.get(agentKey)?.ownershipEpoch ?? "0" });
      return;
    }
    const status: ControlStatus = observation.kind === "controlled" ? "verified" : observation.kind;
    const controller = observation.kind === "controlled" ? observation.controller.toLowerCase() : null;
    let member = this.#members.get(agentKey);
    if (!member) member = newMember(agentKey, chog.traits, observation.ownershipEpoch);
    else if (member.ownershipEpoch !== observation.ownershipEpoch) member = applyTransfer(member, observation.ownershipEpoch, this.#cycle);
    const changed = previous?.status !== status || previous.controller !== controller || this.#members.get(agentKey)?.ownershipEpoch !== member.ownershipEpoch;
    this.#members.set(agentKey, member);
    this.#control.set(agentKey, { status, controller });
    if (changed && previous) this.events.push({ type: "control_changed", cycle: this.#cycle, agentKey, status, ownershipEpoch: member.ownershipEpoch });
  }

  #atTally(): MemberAtTally[] {
    return [...this.#members.values()].map((member) => ({ ...member, control: this.#control.get(member.agentKey)?.status ?? "unavailable" }));
  }

  /** Fresh ownership check for a holder action: only the current controller may act. */
  async #authorize(actor: string, agentKey: AgentKey): Promise<Result<MemberAtTally>> {
    if (!this.#chogs.has(agentKey)) return { ok: false, code: "INVALID_INPUT", message: "Unknown Chog." };
    await this.#observe(agentKey);
    const control = this.#control.get(agentKey)!;
    if (control.status === "unavailable") return { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership cannot be verified right now; try again shortly." };
    if (control.status !== "verified" || control.controller !== actor.toLowerCase()) return { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can do this." };
    return { ok: true, value: { ...this.#members.get(agentKey)!, control: "verified" } };
  }

  async setMembership(actor: string, agentKey: AgentKey, request: { faction?: FactionId | null; stance?: Stance }): Promise<Result<Member>> {
    const authorized = await this.#authorize(actor, agentKey);
    if (!authorized.ok) return authorized;
    const changed = changeMembership(authorized.value, request, this.#cycle);
    if (!changed.ok) return changed;
    const { control: _control, ...member } = changed.value as MemberAtTally;
    this.#members.set(agentKey, member);
    if (member.faction !== authorized.value.faction || member.stance !== authorized.value.stance) {
      this.events.push({ type: "member_changed", cycle: this.#cycle, agentKey, faction: member.faction, stance: member.stance });
    }
    return { ok: true, value: member };
  }

  async override(actor: string, agentKey: AgentKey, place: Place, decreeId: string | null): Promise<Result<VoteRecord>> {
    const authorized = await this.#authorize(actor, agentKey);
    if (!authorized.ok) return authorized;
    const vote = holderOverride(authorized.value, this.#cycle, this.#phase, place, decreeId);
    if (!vote.ok) return vote;
    this.#votes = [...this.#votes.filter((entry) => !(entry.source === "holder" && entry.agentKey === agentKey && entry.place === place)), vote.value];
    this.events.push({ type: "override", cycle: this.#cycle, agentKey, place, decreeId });
    return vote;
  }

  /** Moves to the next phase and performs that phase's work: debate lines, agent votes, or resolution. */
  async advance(): Promise<void> {
    if (this.#phase === "resolve") {
      this.#cycle += 1;
      this.#phase = "propose";
      this.#votes = [];
      this.#cycleStartMs = this.#now();
    } else {
      this.#phase = PHASES[PHASES.indexOf(this.#phase) + 1]!;
    }
    this.events.push({ type: "phase_changed", cycle: this.#cycle, phase: this.#phase });
    if (this.#phase === "debate") {
      for (const agentKey of this.#chogs.keys()) await this.#observe(agentKey);
      const names = Object.fromEntries([...this.#chogs.values()].map((chog) => [chog.agentKey, chog.name]));
      for (const line of debateLines(this.#atTally(), this.#cycle, names)) this.events.push({ type: "debate", cycle: this.#cycle, line });
    }
    if (this.#phase === "vote") {
      for (const agentKey of this.#chogs.keys()) await this.#observe(agentKey);
      const cast = castAgentVotes(this.#atTally(), this.#cycle);
      this.#votes = [...this.#votes.filter((vote) => vote.source === "holder"), ...cast];
      this.events.push({ type: "votes_cast", cycle: this.#cycle, votes: cast.length });
    }
    if (this.#phase === "resolve") await this.resolve();
  }

  /** Resolves the current cycle once. Calling it again returns the stored result without re-applying it. */
  async resolve(): Promise<CycleResult> {
    const existing = this.#results.get(this.#cycle);
    if (existing) return existing;
    if (this.#phase !== "resolve") throw new Error("The cycle can only be resolved in the Resolve phase.");
    for (const agentKey of this.#chogs.keys()) await this.#observe(agentKey);
    let presence: PresenceRecord[] = [];
    const read = await this.#feed.eventsSince(this.#cityCursor);
    if (read.available) {
      const counted = presenceFromCity(read.events, this.#cycle, { fromMs: this.#cycleStartMs, toMs: this.#now() });
      presence = counted.records;
      if (counted.late > 0) this.events.push({ type: "city_late", cycle: this.#cycle, ignored: counted.late });
      const last = read.events.at(-1);
      if (last) this.#cityCursor = last.revision;
    } else {
      // City being down lowers presence to zero; the cycle still resolves and the gap is public.
      this.events.push({ type: "city_gap", cycle: this.#cycle, reason: read.reason });
      if (read.resumeFrom) this.#cityCursor = read.resumeFrom;
    }
    const result = resolveCycle({
      rulesVersion: RULES_VERSION, cycle: this.#cycle, members: this.#atTally(), votes: this.#votes,
      presence, control: this.#placeControl, reputation: this.#reputation,
    });
    this.#results.set(this.#cycle, result);
    this.#placeControl = Object.fromEntries(PLACES.map((place) => [place, result.places[place].control])) as Record<Place, PlaceControl | null>;
    this.#reputation = { ...result.reputation };
    this.events.push({ type: "cycle_resolved", cycle: this.#cycle, result });
    return result;
  }
}
