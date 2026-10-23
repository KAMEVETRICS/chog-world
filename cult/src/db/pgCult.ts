import { createHash } from "node:crypto";
import type pg from "pg";
import type { AgentIdentity, AgentKey, ChainReader, ControlObservation } from "../shared/identity.js";
import { PHASES, PLACES, RULES_VERSION, TIMING, type FactionId, type Phase, type Place, type Stance } from "../rules.js";
import { presenceFromCity, type CityFeed, type CityFeedRead } from "../city/feed.js";
import { debateLines, type DebateLine } from "../engine/debate.js";
import { isEligible } from "../engine/eligibility.js";
import { applyTransfer, changeMembership, newMember } from "../engine/membership.js";
import { resolveCycle } from "../engine/resolveCycle.js";
import { castAgentVotes, holderOverride } from "../engine/votes.js";
import type { ControlStatus, CycleInput, CycleResult, Member, MemberAtTally, PlaceControl, PresenceRecord, Reputation, Result, VoteRecord } from "../engine/types.js";
import type { CouncilChog } from "../council/memoryCouncil.js";
import type { AiResult } from "../soul/service.js";

/** What Cult needs from Chog Soul: paid AI debate lines and votes, settled with the transition that uses them. */
export interface CultSoul {
  debate(members: readonly MemberAtTally[], lines: readonly DebateLine[], cycle: number): Promise<Map<string, AiResult<string>>>;
  votes(members: readonly MemberAtTally[], cycle: number): Promise<Map<string, AiResult<Partial<Record<Place, string>>>>>;
  settle(db: pg.PoolClient, results: Iterable<AiResult<unknown>>, used: (result: AiResult<unknown>) => boolean): Promise<void>;
  release(results: Iterable<AiResult<unknown>>): Promise<void>;
}

type TimingName = keyof typeof TIMING;
type Db = pg.PoolClient;

export type StepOutcome =
  | { readonly kind: "not_due"; readonly nextBoundaryAtMs: number }
  | { readonly kind: "stale" }
  | { readonly kind: "advanced"; readonly cycle: number; readonly phase: Phase };

export interface CultEvent {
  readonly revision: string;
  readonly cycle: number;
  readonly type: string;
  readonly payload: unknown;
}

interface RuntimeRow {
  timing: TimingName;
  cycle: number;
  phase: Phase;
  cycle_started_at: Date;
  next_boundary_at: Date;
  revision: string;
  city_cursor: string;
}

interface MemberRow {
  agent_key: string;
  name: string;
  identity: AgentIdentity;
  traits: Record<string, string>;
  faction: FactionId | null;
  stance: Stance;
  joined_cycle: number | null;
  last_switch_cycle: number | null;
  ownership_epoch: string;
  history: Member["history"];
  control_status: ControlStatus;
  controller: string | null;
}

const cycleLength = (timing: TimingName) => PHASES.reduce((sum, phase) => sum + TIMING[timing].phaseMs[phase], 0);

function toMember(row: MemberRow): MemberAtTally {
  return {
    agentKey: row.agent_key as AgentKey, faction: row.faction, stance: row.stance, joinedCycle: row.joined_cycle,
    lastSwitchCycle: row.last_switch_cycle, ownershipEpoch: String(row.ownership_epoch), traits: row.traits,
    history: row.history, control: row.control_status,
  };
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Tracks the public revision inside one transaction; events and the runtime row commit together. */
class Tx {
  constructor(readonly db: Db, public revision: bigint, readonly nowMs: number) {}
  async emit(cycle: number, type: string, payload: unknown): Promise<void> {
    this.revision += 1n;
    await this.db.query("INSERT INTO cult_events (revision, cycle, type, payload, created_at) VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))",
      [this.revision.toString(), cycle, type, JSON.stringify(payload), this.nowMs]);
  }
}

export interface ActionOptions {
  readonly expectedEpoch?: string;
  readonly idempotency?: { readonly sessionId: string; readonly key: string; readonly requestHash: string };
}

export interface PgCultOptions {
  readonly pool: pg.Pool;
  readonly reader: ChainReader;
  readonly feed: CityFeed;
  /** Scheduling time in ms. Defaults to the database clock; tests inject a manual clock. */
  readonly now?: () => Promise<number> | number;
  /** Chog Soul: Chogs whose holders opted in write their own debate lines and choose their votes. */
  readonly soul?: CultSoul;
}

/**
 * Chog Cult on PostgreSQL. Every state change locks the single `cult_runtime` row first, then member rows,
 * and commits its events in the same transaction. Network reads (ownership, City feed) happen before
 * the lock; a transition re-checks that the runtime did not move while it was reading.
 */
export class PgCult {
  readonly #pool: pg.Pool;
  readonly #reader: ChainReader;
  readonly #feed: CityFeed;
  readonly #now: (() => Promise<number> | number) | undefined;
  readonly #soul: CultSoul | undefined;
  #running = false;

  constructor(options: PgCultOptions) {
    this.#pool = options.pool;
    this.#reader = options.reader;
    this.#feed = options.feed;
    this.#now = options.now;
    this.#soul = options.soul;
  }

  async #clock(): Promise<number> {
    if (this.#now) return this.#now();
    const { rows } = await this.#pool.query<{ ms: number }>("SELECT (extract(epoch FROM clock_timestamp()) * 1000)::float8 AS ms");
    return Math.floor(rows[0]!.ms);
  }

  async #transaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
    const db = await this.#pool.connect();
    try {
      await db.query("BEGIN");
      const result = await work(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      // The original error is what matters; a failed ROLLBACK on a broken connection adds nothing.
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async #lockRuntime(db: Db): Promise<RuntimeRow> {
    const { rows } = await db.query<RuntimeRow>("SELECT timing, cycle, phase, cycle_started_at, next_boundary_at, revision, city_cursor FROM cult_runtime WHERE id = 1 FOR UPDATE");
    if (!rows[0]) throw new Error("Chog Cult is not initialized.");
    return rows[0];
  }

  /** Creates the runtime row (cycle 0, Propose) once. Later calls change nothing. */
  async initialize(timing: TimingName): Promise<void> {
    const now = await this.#clock();
    await this.#transaction(async (db) => {
      await db.query(
        `INSERT INTO cult_runtime (id, rules_version, timing, cycle, phase, cycle_started_at, phase_started_at, next_boundary_at)
         VALUES (1, $1, $2, 0, 'propose', to_timestamp($3 / 1000.0), to_timestamp($3 / 1000.0), to_timestamp(($3 + $4) / 1000.0))
         ON CONFLICT (id) DO NOTHING`, [RULES_VERSION, timing, now, TIMING[timing].phaseMs.propose]);
      for (const place of PLACES) await db.query("INSERT INTO place_control (place) VALUES ($1) ON CONFLICT (place) DO NOTHING", [place]);
    });
  }

  /** Registers Chogs admitted to City, with their current ownership. Existing members are left unchanged. */
  async registerChogs(chogs: readonly CouncilChog[]): Promise<void> {
    const observed = await Promise.all(chogs.map(async (chog) => [chog, await this.#reader.resolveAgent(chog.identity)] as const));
    await this.#transaction(async (db) => {
      await this.#lockRuntime(db);
      for (const [chog, observation] of observed) {
        if (observation.kind === "unavailable") throw new Error(`Cannot register ${chog.name}: ownership is unavailable.`);
        const member = newMember(chog.agentKey, chog.traits, observation.ownershipEpoch);
        await db.query(
          `INSERT INTO members (agent_key, name, identity, traits, stance, ownership_epoch, history, control_status, controller)
           VALUES ($1, $2, $3, $4, $5, $6, '[]', $7, $8) ON CONFLICT (agent_key) DO NOTHING`,
          [chog.agentKey, chog.name, JSON.stringify(chog.identity), JSON.stringify(chog.traits), member.stance, member.ownershipEpoch,
            observation.kind === "controlled" ? "verified" : observation.kind, observation.kind === "controlled" ? observation.controller.toLowerCase() : null]);
      }
    });
  }

  async #observeAll(): Promise<Map<string, ControlObservation>> {
    const { rows } = await this.#pool.query<{ agent_key: string; identity: AgentIdentity }>("SELECT agent_key, identity FROM members ORDER BY agent_key");
    return new Map(await Promise.all(rows.map(async (row) => [row.agent_key, await this.#reader.resolveAgent(row.identity)] as const)));
  }

  async #saveMember(db: Db, member: Member, control: { status: ControlStatus; controller: string | null }): Promise<void> {
    await db.query(
      `UPDATE members SET faction = $2, stance = $3, joined_cycle = $4, last_switch_cycle = $5, ownership_epoch = $6, history = $7,
       control_status = $8, controller = $9 WHERE agent_key = $1`,
      [member.agentKey, member.faction, member.stance, member.joinedCycle, member.lastSwitchCycle, member.ownershipEpoch,
        JSON.stringify(member.history), control.status, control.controller]);
  }

  /**
   * Applies fresh ownership observations to locked member rows: a newer epoch resets the member (transfer),
   * an outage freezes it, and an observation older than the stored epoch is ignored.
   */
  async #applyObservations(tx: Tx, cycle: number, observations: ReadonlyMap<string, ControlObservation>): Promise<MemberAtTally[]> {
    const { rows } = await tx.db.query<MemberRow>("SELECT * FROM members ORDER BY agent_key FOR UPDATE");
    const result: MemberAtTally[] = [];
    for (const row of rows) {
      const stored = toMember(row);
      const observation = observations.get(row.agent_key);
      if (!observation) { result.push(stored); continue; }
      let member: Member = stored;
      let status: ControlStatus;
      let controller = row.controller;
      if (observation.kind === "unavailable") status = "unavailable";
      else if (BigInt(observation.ownershipEpoch) < BigInt(stored.ownershipEpoch)) { result.push(stored); continue; }
      else {
        status = observation.kind === "controlled" ? "verified" : observation.kind;
        controller = observation.kind === "controlled" ? observation.controller.toLowerCase() : null;
        if (observation.ownershipEpoch !== stored.ownershipEpoch) member = applyTransfer(stored, observation.ownershipEpoch, cycle);
      }
      if (status !== row.control_status || controller !== row.controller || member !== stored) {
        await this.#saveMember(tx.db, member, { status, controller });
        await tx.emit(cycle, "control_changed", { agentKey: row.agent_key, status, ownershipEpoch: member.ownershipEpoch });
      }
      result.push({ ...member, control: status });
    }
    return result;
  }

  async #authorize(tx: Tx, cycle: number, actor: string, agentKey: AgentKey, observation: ControlObservation): Promise<Result<MemberAtTally>> {
    const members = await this.#applyObservations(tx, cycle, new Map([[agentKey, observation]]));
    const member = members.find((entry) => entry.agentKey === agentKey);
    if (!member) return { ok: false, code: "INVALID_INPUT", message: "Unknown Chog." };
    if (member.control === "unavailable") return { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership cannot be verified right now; try again shortly." };
    const { rows } = await tx.db.query<{ controller: string | null }>("SELECT controller FROM members WHERE agent_key = $1", [agentKey]);
    if (member.control !== "verified" || rows[0]?.controller !== actor.toLowerCase()) return { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can do this." };
    return { ok: true, value: member };
  }

  async #observeOne(agentKey: AgentKey): Promise<ControlObservation | null> {
    const { rows } = await this.#pool.query<{ identity: AgentIdentity }>("SELECT identity FROM members WHERE agent_key = $1", [agentKey]);
    return rows[0] ? this.#reader.resolveAgent(rows[0].identity) : null;
  }

  /**
   * Replays a stored response for the same idempotency key and request, or refuses a reused key with a
   * different request. Runs after the runtime lock, so concurrent retries are serialized.
   */
  async #idempotentReplay<T>(db: Db, options: ActionOptions, agentKey: AgentKey, operation: "membership" | "vote"): Promise<Result<T> | null> {
    const idem = options.idempotency;
    if (!idem) return null;
    const { rows } = await db.query<{ request_hash: string; response: Result<T> }>(
      "SELECT request_hash, response FROM idempotency_records WHERE session_id = $1 AND agent_key = $2 AND operation = $3 AND key = $4",
      [idem.sessionId, agentKey, operation, idem.key]);
    if (!rows[0]) return null;
    if (rows[0].request_hash !== idem.requestHash) return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used for a different request." };
    return rows[0].response;
  }

  async #idempotentStore(db: Db, options: ActionOptions, agentKey: AgentKey, operation: "membership" | "vote", outcome: Result<unknown>, nowMs: number): Promise<void> {
    const idem = options.idempotency;
    // A transient outage is not a final answer: the same key may be retried and succeed.
    if (!idem || (!outcome.ok && outcome.code === "OWNERSHIP_UNAVAILABLE")) return;
    await db.query(
      "INSERT INTO idempotency_records (session_id, agent_key, operation, key, request_hash, response, created_at) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))",
      [idem.sessionId, agentKey, operation, idem.key, idem.requestHash, JSON.stringify(outcome), nowMs]);
  }

  /** A holder's faction or stance change. `expectedEpoch` refuses a form made before the Chog changed hands. */
  async setMembership(actor: string, agentKey: AgentKey, request: { faction?: FactionId | null; stance?: Stance }, options: ActionOptions = {}): Promise<Result<Member>> {
    const observation = await this.#observeOne(agentKey);
    if (!observation) return { ok: false, code: "INVALID_INPUT", message: "Unknown Chog." };
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      const replay = await this.#idempotentReplay<Member>(db, options, agentKey, "membership");
      if (replay) return replay;
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const authorized = await this.#authorize(tx, runtime.cycle, actor, agentKey, observation);
      let outcome: Result<Member> = authorized;
      if (authorized.ok && options.expectedEpoch !== undefined && authorized.value.ownershipEpoch !== options.expectedEpoch) {
        outcome = { ok: false, code: "CONTROL_CHANGED", message: "This Chog changed hands since the form was loaded; reload and try again." };
      } else if (authorized.ok) {
        const { control: _control, ...current } = authorized.value;
        const changed = changeMembership(current, request, runtime.cycle);
        outcome = changed;
        if (changed.ok && changed.value !== current) {
          await this.#saveMember(db, changed.value, { status: "verified", controller: actor.toLowerCase() });
          await tx.emit(runtime.cycle, "member_changed", { agentKey, faction: changed.value.faction, stance: changed.value.stance });
        }
      }
      // Ownership changes detected while authorizing are committed even when the action is refused.
      await db.query("UPDATE cult_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      await this.#idempotentStore(db, options, agentKey, "membership", outcome, now);
      return outcome;
    });
  }

  /** A holder's vote override (or abstention, with `decreeId` null) for one place in `expectedCycle`. */
  async override(actor: string, agentKey: AgentKey, place: Place, decreeId: string | null, options: ActionOptions & { expectedCycle?: number } = {}): Promise<Result<VoteRecord>> {
    const observation = await this.#observeOne(agentKey);
    if (!observation) return { ok: false, code: "INVALID_INPUT", message: "Unknown Chog." };
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      const replay = await this.#idempotentReplay<VoteRecord>(db, options, agentKey, "vote");
      if (replay) return replay;
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const authorized = await this.#authorize(tx, runtime.cycle, actor, agentKey, observation);
      let outcome: Result<VoteRecord>;
      if (!authorized.ok) outcome = authorized;
      else if (options.expectedEpoch !== undefined && authorized.value.ownershipEpoch !== options.expectedEpoch) {
        outcome = { ok: false, code: "CONTROL_CHANGED", message: "This Chog changed hands since the form was loaded; reload and try again." };
      } else if (options.expectedCycle !== undefined && options.expectedCycle !== runtime.cycle) {
        outcome = { ok: false, code: "VOTING_CLOSED", message: `Cycle ${options.expectedCycle}'s vote is over; the council is in cycle ${runtime.cycle}.` };
      } else outcome = holderOverride(authorized.value, runtime.cycle, runtime.phase, place, decreeId);
      if (outcome.ok) {
        const vote = outcome.value;
        await db.query(
          `INSERT INTO votes (cycle, agent_key, place, source, faction, decree_id, ownership_epoch) VALUES ($1, $2, $3, 'holder', $4, $5, $6)
           ON CONFLICT (cycle, agent_key, place, source) DO UPDATE SET faction = EXCLUDED.faction, decree_id = EXCLUDED.decree_id, ownership_epoch = EXCLUDED.ownership_epoch`,
          [vote.cycle, vote.agentKey, vote.place, vote.faction, vote.decreeId, vote.ownershipEpoch]);
        await tx.emit(runtime.cycle, "override", { agentKey, place, decreeId });
      }
      await db.query("UPDATE cult_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      await this.#idempotentStore(db, options, agentKey, "vote", outcome, now);
      return outcome;
    });
  }

  /**
   * Members as they will look at the next transition, without locking: stored rows with fresh control applied
   * (a newer epoch resets the member). Used to ask Soul before the lock; the transition re-checks each one.
   */
  async #preview(cycle: number, observations: ReadonlyMap<string, ControlObservation>): Promise<{ members: MemberAtTally[]; names: Record<string, string> }> {
    const { rows } = await this.#pool.query<MemberRow>("SELECT * FROM members ORDER BY agent_key");
    const members = rows.map((row): MemberAtTally => {
      const stored = toMember(row);
      const observation = observations.get(row.agent_key);
      if (!observation) return stored;
      if (observation.kind === "unavailable") return { ...stored, control: "unavailable" };
      const control: ControlStatus = observation.kind === "controlled" ? "verified" : observation.kind;
      if (BigInt(observation.ownershipEpoch) > BigInt(stored.ownershipEpoch)) return { ...applyTransfer(stored, observation.ownershipEpoch, cycle), control };
      return { ...stored, control };
    });
    return { members, names: Object.fromEntries(rows.map((row) => [row.agent_key, row.name])) };
  }

  /** Performs at most one due phase transition. Safe to call from several processes at once. */
  async step(): Promise<StepOutcome> {
    const { rows } = await this.#pool.query<RuntimeRow>("SELECT timing, cycle, phase, cycle_started_at, next_boundary_at, revision, city_cursor FROM cult_runtime WHERE id = 1");
    const captured = rows[0];
    if (!captured) throw new Error("Chog Cult is not initialized.");
    const now = await this.#clock();
    if (now < captured.next_boundary_at.getTime()) return { kind: "not_due", nextBoundaryAtMs: captured.next_boundary_at.getTime() };
    const target: Phase = captured.phase === "resolve" ? "propose" : PHASES[PHASES.indexOf(captured.phase) + 1]!;

    // Reads that may be slow or fail happen before any lock is taken.
    const observations = target === "propose" ? new Map<string, ControlObservation>() : await this.#observeAll();
    const feedRead: CityFeedRead | null = target === "resolve" ? await this.#feed.eventsSince(captured.city_cursor) : null;
    // Paid AI calls also happen before the lock; anything the transition does not use is refunded.
    const soul = this.#soul;
    const previewCycle = target === "propose" ? captured.cycle + 1 : captured.cycle;
    let aiDebate = new Map<string, AiResult<string>>();
    let aiVotes = new Map<string, AiResult<Partial<Record<Place, string>>>>();
    const previewEpochs = new Map<string, string>();
    if (soul && (target === "debate" || target === "vote")) {
      const preview = await this.#preview(previewCycle, observations);
      for (const member of preview.members) previewEpochs.set(member.agentKey, member.ownershipEpoch);
      if (target === "debate") aiDebate = await soul.debate(preview.members, debateLines(preview.members, previewCycle, preview.names), previewCycle);
      else aiVotes = await soul.votes(preview.members.filter((member) => member.stance === "persona" && isEligible(member, previewCycle)), previewCycle);
    }
    const aiResults: AiResult<unknown>[] = [...aiDebate.values(), ...aiVotes.values()];

    let outcome: StepOutcome;
    try {
      outcome = await this.#transition(captured, target, now, observations, feedRead, { aiDebate, aiVotes, previewEpochs });
    } catch (error) {
      if (soul && aiResults.length) await soul.release(aiResults).catch(() => {});
      throw error;
    }
    if (outcome.kind === "stale" && soul && aiResults.length) await soul.release(aiResults);
    return outcome;
  }

  async #transition(
    captured: RuntimeRow, target: Phase, now: number, observations: ReadonlyMap<string, ControlObservation>, feedRead: CityFeedRead | null,
    ai: { aiDebate: Map<string, AiResult<string>>; aiVotes: Map<string, AiResult<Partial<Record<Place, string>>>>; previewEpochs: Map<string, string> },
  ): Promise<StepOutcome> {
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      if (runtime.cycle !== captured.cycle || runtime.phase !== captured.phase || runtime.next_boundary_at.getTime() !== captured.next_boundary_at.getTime()) {
        return { kind: "stale" } as const;
      }
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const cycle = target === "propose" ? runtime.cycle + 1 : runtime.cycle;
      const overdueMs = now - runtime.next_boundary_at.getTime();
      if (overdueMs > cycleLength(runtime.timing)) {
        // Downtime: the overdue phase simply ends now. Skipped time is recorded, never simulated.
        await tx.emit(cycle, "schedule_gap", { overdueMs });
      }
      const members = await this.#applyObservations(tx, cycle, observations);
      // An AI result is used only for a member still eligible at the epoch it was paid for.
      const sameEpoch = (agentKey: string) => members.some((member) => member.agentKey === agentKey && ai.previewEpochs.get(agentKey) === member.ownershipEpoch);
      const used = new Set<string>();
      if (target === "debate") {
        const names = Object.fromEntries((await db.query<{ agent_key: string; name: string }>("SELECT agent_key, name FROM members")).rows.map((row) => [row.agent_key, row.name]));
        for (const line of debateLines(members, cycle, names)) {
          const written = ai.aiDebate.get(line.agentKey);
          if (written && sameEpoch(line.agentKey)) {
            used.add(written.usageId);
            await tx.emit(cycle, "debate", { ...line, text: written.value, scripted: false });
          } else {
            await tx.emit(cycle, "debate", line);
          }
        }
        if (this.#soul && ai.aiDebate.size) await this.#soul.settle(db, ai.aiDebate.values(), (result) => used.has(result.usageId));
      }
      if (target === "vote") {
        const choices = new Map<string, Partial<Record<Place, string>>>();
        for (const [agentKey, result] of ai.aiVotes) if (sameEpoch(agentKey)) choices.set(agentKey, result.value);
        const cast = castAgentVotes(members, cycle, choices);
        for (const [agentKey, result] of ai.aiVotes) if (choices.has(agentKey) && cast.some((vote) => vote.agentKey === agentKey)) used.add(result.usageId);
        if (this.#soul && ai.aiVotes.size) await this.#soul.settle(db, ai.aiVotes.values(), (result) => used.has(result.usageId));
        for (const vote of cast) {
          await db.query(
            `INSERT INTO votes (cycle, agent_key, place, source, faction, decree_id, ownership_epoch) VALUES ($1, $2, $3, 'agent', $4, $5, $6)
             ON CONFLICT (cycle, agent_key, place, source) DO NOTHING`,
            [vote.cycle, vote.agentKey, vote.place, vote.faction, vote.decreeId, vote.ownershipEpoch]);
        }
        await tx.emit(cycle, "votes_cast", { votes: cast.length, chosenByAi: used.size });
      }
      if (target === "resolve") await this.#resolve(tx, runtime, members, feedRead!);
      const cycleStarted = target === "propose" ? now : runtime.cycle_started_at.getTime();
      await tx.emit(cycle, "phase_changed", { phase: target });
      await db.query(
        `UPDATE cult_runtime SET cycle = $1, phase = $2, cycle_started_at = to_timestamp($3 / 1000.0), phase_started_at = to_timestamp($4 / 1000.0),
         next_boundary_at = to_timestamp(($4 + $5) / 1000.0), revision = $6 WHERE id = 1`,
        [cycle, target, cycleStarted, now, TIMING[runtime.timing].phaseMs[target], tx.revision.toString()]);
      return { kind: "advanced", cycle, phase: target } as const;
    });
  }

  /** Runs due transitions until none is due (bounded, so a stuck clock cannot loop forever). */
  async runDue(maxSteps = PHASES.length * 2): Promise<StepOutcome[]> {
    // One run at a time per process: a slow AI phase must not start a second, paid, duplicate attempt.
    if (this.#running) return [];
    this.#running = true;
    try { return await this.#runDue(maxSteps); } finally { this.#running = false; }
  }

  async #runDue(maxSteps: number): Promise<StepOutcome[]> {
    const outcomes: StepOutcome[] = [];
    for (let index = 0; index < maxSteps; index++) {
      const outcome = await this.step();
      outcomes.push(outcome);
      if (outcome.kind !== "advanced") break;
    }
    return outcomes;
  }

  async #resolve(tx: Tx, runtime: RuntimeRow, members: readonly MemberAtTally[], feedRead: CityFeedRead): Promise<void> {
    const { db } = tx;
    const cycle = runtime.cycle;
    const existing = await db.query("SELECT 1 FROM cycle_results WHERE cycle = $1", [cycle]);
    if (existing.rowCount) return;
    if (feedRead.available) {
      const counted = presenceFromCity(feedRead.events, cycle, { fromMs: runtime.cycle_started_at.getTime(), toMs: tx.nowMs });
      for (const record of counted.records) {
        await db.query("INSERT INTO presence (cycle, city_revision, agent_key, place, points) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
          [record.cycle, record.cityRevision, record.agentKey, record.place, record.points]);
      }
      if (counted.late > 0) await tx.emit(cycle, "city_late", { ignored: counted.late });
      const last = feedRead.events.at(-1);
      if (last) await db.query("UPDATE cult_runtime SET city_cursor = $1 WHERE id = 1", [last.revision]);
    } else {
      await tx.emit(cycle, "city_gap", { reason: feedRead.reason });
      if (feedRead.resumeFrom) await db.query("UPDATE cult_runtime SET city_cursor = $1 WHERE id = 1", [feedRead.resumeFrom]);
    }

    const votes = (await db.query<{ cycle: number; agent_key: string; place: Place; source: "agent" | "holder"; faction: FactionId; decree_id: string | null; ownership_epoch: string }>(
      "SELECT * FROM votes WHERE cycle = $1 ORDER BY agent_key, place, source", [cycle])).rows
      .map((row): VoteRecord => ({ cycle: row.cycle, agentKey: row.agent_key as AgentKey, place: row.place, faction: row.faction, decreeId: row.decree_id, source: row.source, ownershipEpoch: String(row.ownership_epoch) }));
    const presence = (await db.query<{ cycle: number; city_revision: string; agent_key: string; place: Place; points: number }>(
      "SELECT * FROM presence WHERE cycle = $1 ORDER BY city_revision, agent_key, place", [cycle])).rows
      .map((row): PresenceRecord => ({ cycle: row.cycle, agentKey: row.agent_key as AgentKey, place: row.place, points: row.points, cityRevision: String(row.city_revision) }));
    const control = Object.fromEntries(PLACES.map((place) => [place, null])) as Record<Place, PlaceControl | null>;
    for (const row of (await db.query<{ place: Place; faction: FactionId | null; decree_id: string | null; since_cycle: number | null }>("SELECT * FROM place_control")).rows) {
      control[row.place] = row.faction ? { faction: row.faction, decreeId: row.decree_id!, sinceCycle: row.since_cycle! } : null;
    }
    const reputation: Record<string, Reputation> = {};
    for (const row of (await db.query<{ agent_key: string; loyalty: number; glory: number }>("SELECT * FROM reputation ORDER BY agent_key")).rows) {
      reputation[row.agent_key] = { loyalty: row.loyalty, glory: row.glory };
    }
    const input: CycleInput = {
      rulesVersion: RULES_VERSION, cycle, members: [...members].sort((a, b) => (a.agentKey < b.agentKey ? -1 : 1)), votes, presence, control, reputation,
    };
    const result = resolveCycle(input);
    await db.query("INSERT INTO cycle_results (cycle, rules_version, input_hash, result_hash, result, resolved_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))",
      [cycle, RULES_VERSION, sha256(input), sha256(result), JSON.stringify(result), tx.nowMs]);
    for (const place of PLACES) {
      const next = result.places[place].control;
      await db.query("UPDATE place_control SET faction = $2, decree_id = $3, since_cycle = $4 WHERE place = $1", [place, next?.faction ?? null, next?.decreeId ?? null, next?.sinceCycle ?? null]);
      if (JSON.stringify(next) !== JSON.stringify(control[place])) await tx.emit(cycle, "place_control_changed", { place, control: next });
    }
    for (const [agentKey, rep] of Object.entries(result.reputation)) {
      await db.query("INSERT INTO reputation (agent_key, loyalty, glory) VALUES ($1, $2, $3) ON CONFLICT (agent_key) DO UPDATE SET loyalty = EXCLUDED.loyalty, glory = EXCLUDED.glory",
        [agentKey, rep.loyalty, rep.glory]);
    }
    await tx.emit(cycle, "cycle_resolved", { cycle, resultHash: sha256(result) });
  }

  async runtime(): Promise<{ cycle: number; phase: Phase; nextBoundaryAtMs: number; revision: string; cityCursor: string }> {
    const { rows } = await this.#pool.query<RuntimeRow>("SELECT * FROM cult_runtime WHERE id = 1");
    const row = rows[0]!;
    return { cycle: row.cycle, phase: row.phase, nextBoundaryAtMs: row.next_boundary_at.getTime(), revision: String(row.revision), cityCursor: String(row.city_cursor) };
  }

  async member(agentKey: AgentKey): Promise<MemberAtTally | undefined> {
    const { rows } = await this.#pool.query<MemberRow>("SELECT * FROM members WHERE agent_key = $1", [agentKey]);
    return rows[0] ? toMember(rows[0]) : undefined;
  }

  async result(cycle: number): Promise<CycleResult | undefined> {
    const { rows } = await this.#pool.query<{ result: CycleResult }>("SELECT result FROM cycle_results WHERE cycle = $1", [cycle]);
    return rows[0]?.result;
  }

  async reputation(): Promise<Record<string, Reputation>> {
    const { rows } = await this.#pool.query<{ agent_key: string; loyalty: number; glory: number }>("SELECT * FROM reputation ORDER BY agent_key");
    return Object.fromEntries(rows.map((row) => [row.agent_key, { loyalty: row.loyalty, glory: row.glory }]));
  }

  async events(afterRevision = "0"): Promise<CultEvent[]> {
    const { rows } = await this.#pool.query<{ revision: string; cycle: number; type: string; payload: unknown }>(
      "SELECT revision, cycle, type, payload FROM cult_events WHERE revision > $1 ORDER BY revision", [afterRevision]);
    return rows.map((row) => ({ revision: String(row.revision), cycle: row.cycle, type: row.type, payload: row.payload }));
  }
}
