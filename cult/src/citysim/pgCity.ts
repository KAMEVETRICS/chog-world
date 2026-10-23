import type pg from "pg";
import type { AgentIdentity as CultIdentity, ChainReader, ControlObservation } from "../shared/identity.js";
import {
  ADMISSION_GRANT, NEED_START, applyDecor, CITY_LOTS, CITY_PLACES, defaultParams, emptyProjects, CITY_PLOTS, DEFAULT_HOME_STYLE, FIXTURE_CITY_ID, MAX_CATCH_UP_TICKS, RESOURCES, RULESET_VERSION, TICK_MS,
  GENESIS_TREASURY_COINS, councilDue, runCouncilSession, type CouncilSeat, accountEntry, admitCitizen, applyAction, applyJobChange, citizenKeyOf, reconcileAccounts,
  type AccountEntry, type CitizenState, type CityAction, type JobRequest, type JoinRequest, type ParamState, type ProjectState, type Treasury,
  applyControlChange, applyPolicyChange, cityIdentity, cityObservation, cultIdentity, hashJson, hashWorld, ledgerLine, makeCityAgentKey, step,
  type AgentState, type DecorId, type CityEventType, type CityIdentity, type CityObservation, type LedgerEntry, type Policy, type PublicChange, type WorldState,
} from "./world.js";

type Db = pg.PoolClient;

export type CityErrorCode =
  | "INVALID_INPUT" | "NOT_FOUND" | "NOT_CONTROLLER" | "NOT_AWAKENED" | "OWNERSHIP_UNAVAILABLE"
  | "CONTROL_CHANGED" | "POLICY_CHANGED" | "IDEMPOTENCY_CONFLICT" | "CITY_FULL"
  | "ALREADY_OWNED" | "DECOR_FULL" | "CANT_AFFORD"
  | "DISTRICT_FULL" | "NOT_A_CITIZEN" | "JOB_CHANGED"
  | "NOT_ENOUGH" | "NO_ROOM" | "TREASURY_EMPTY" | "MARKET_EMPTY" | "NO_OFFER" | "OFFER_TAKEN" | "NOT_NEEDED" | "NOT_ALLOWED"
  | "CANT_VOTE_YET" | "VOTE_CLOSED" | "TOO_MANY_PROPOSALS";
export type CityResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: CityErrorCode; readonly message: string };

export type CityStepOutcome =
  | { readonly kind: "not_due"; readonly nextDueAtMs: number }
  | { readonly kind: "stale" }
  | { readonly kind: "advanced"; readonly tick: string; readonly ran: number; readonly skipped: number };

export type PolicyRequest = Pick<Policy, "active" | "focus" | "homeStyle">;

type Idempotency = { readonly sessionId: string; readonly key: string; readonly requestHash: string };

export interface PolicyOptions {
  readonly expectedVersion: string;
  readonly expectedEpoch: string;
  readonly idempotency?: Idempotency;
}

export interface DecorOptions {
  readonly expectedEpoch: string;
  readonly idempotency?: Idempotency;
}

/** A Chog arriving in City: its identity under the verified deployment, and the name City shows. */
export interface Arrival {
  readonly identity: CultIdentity;
  readonly name: string;
}

export interface RuntimeRow {
  city_id: string; seed: string; ruleset_version: string; tick: string; next_due_at: Date; revision: string;
  /** Set by initialize(); null only before the first start after migration 009. */
  params: ParamState | null; treasury: Treasury | null; projects: Record<string, ProjectState> | null;
  proposals: WorldState["proposals"] | null; proposal_seq: number;
  last_council_tick: string | null;
}

export interface CitizenRow {
  citizen_key: string; address: string; name: string; look: CitizenState["look"]; lot_id: string; location: CitizenState["location"];
  job: CitizenState["job"]; job_version: string; coins: number; joined_tick: string; active_days: number; last_worked_day: number | null;
  employer: string | null;
}

export function toCitizen(row: CitizenRow): CitizenState {
  return {
    key: row.citizen_key, address: row.address, name: row.name, look: row.look, lotId: row.lot_id, location: row.location, job: row.job,
    jobVersion: String(row.job_version), coins: row.coins, joinedTick: String(row.joined_tick), activeDays: row.active_days,
    lastWorkedDay: row.last_worked_day, employer: row.employer,
  };
}

const CITIZEN_COLUMNS = ["address", "name", "look", "lot_id", "location", "job", "job_version", "coins", "joined_tick", "active_days", "last_worked_day", "employer"] as const;

function citizenValues(c: CitizenState): unknown[] {
  return [c.address, c.name, JSON.stringify(c.look), c.lotId, JSON.stringify(c.location), c.job, c.jobVersion, c.coins, c.joinedTick, c.activeDays, c.lastWorkedDay, c.employer];
}

type Control = AgentState["control"];
export interface AgentRow {
  agent_key: string; identity: CityIdentity; chain_id: string; collection: string; token_id: string; name: string; plot_id: string;
  location: AgentState["location"]; control_kind: Control["kind"]; controller: string | null; ownership_epoch: string;
  projection_generation: string; control_block_number: string; control_block_hash: string; control_observed_at_ms: string;
  control_availability: AgentState["controlAvailability"]; policy_version: string; active: boolean; focus: Policy["focus"];
  policy_home_style: Policy["homeStyle"]; home_level: number; home_style: AgentState["homeStyle"]; construction: AgentState["construction"];
  last_greeting_tick: string | null; wood_total: number; wood_reserved: number; stone_total: number; stone_reserved: number;
  food_total: number; food_reserved: number; needs: AgentState["needs"]; decor: AgentState["decor"];
  coins: number; offer: AgentState["offer"];
}

export function toAgent(row: AgentRow): AgentState {
  return {
    key: row.agent_key, identity: row.identity, name: row.name,
    control: {
      kind: row.control_kind, controller: row.controller, epoch: String(row.ownership_epoch), projectionGeneration: String(row.projection_generation),
      blockNumber: String(row.control_block_number), blockHash: row.control_block_hash, observedAtMs: Number(row.control_observed_at_ms),
    },
    controlAvailability: row.control_availability, plotId: row.plot_id, location: row.location,
    policy: { version: String(row.policy_version), active: row.active, focus: row.focus, homeStyle: row.policy_home_style },
    inventory: {
      wood: { total: row.wood_total, reserved: row.wood_reserved },
      stone: { total: row.stone_total, reserved: row.stone_reserved },
      food: { total: row.food_total, reserved: row.food_reserved },
    },
    homeLevel: row.home_level, homeStyle: row.home_style, construction: row.construction,
    lastGreetingTick: row.last_greeting_tick === null ? null : String(row.last_greeting_tick),
    needs: row.needs, decor: row.decor, coins: row.coins, offer: row.offer,
  };
}

/** City's WorldState from the runtime row and every resident (in agent-key order). */
export function worldOf(runtime: RuntimeRow, rows: readonly AgentRow[], citizens: readonly CitizenRow[] = []): WorldState {
  return {
    cityId: runtime.city_id, tick: String(runtime.tick), seed: runtime.seed, rulesetVersion: runtime.ruleset_version,
    places: CITY_PLACES.map((place) => ({ ...place })), plots: CITY_PLOTS.map((plot) => ({ ...plot })), agents: rows.map(toAgent),
    lots: CITY_LOTS.map((lot) => ({ ...lot })), citizens: citizens.map(toCitizen),
    // Filled on the first start after migration 009; the defaults only cover reads before that.
    params: runtime.params ?? { version: "1", values: defaultParams() },
    treasury: runtime.treasury ?? { coins: 0, stores: { wood: 0, stone: 0, food: 0 } },
    projects: { ...emptyProjects(), ...(runtime.projects ?? {}) } as WorldState["projects"],
    proposals: runtime.proposals ?? [], proposalSeq: runtime.proposal_seq ?? 0,
  };
}

// Everything about a resident that the simulation can change, in column order.
const STATE_COLUMNS = [
  "location", "control_kind", "controller", "ownership_epoch", "projection_generation", "control_block_number", "control_block_hash",
  "control_observed_at_ms", "control_availability", "policy_version", "active", "focus", "policy_home_style", "home_level", "home_style",
  "construction", "last_greeting_tick", "wood_total", "wood_reserved", "stone_total", "stone_reserved", "food_total", "food_reserved",
  "needs", "decor", "coins", "offer",
] as const;

function stateValues(agent: AgentState): unknown[] {
  const { control, policy, inventory } = agent;
  return [
    JSON.stringify(agent.location), control.kind, control.controller, control.epoch, control.projectionGeneration, control.blockNumber,
    control.blockHash, control.observedAtMs, agent.controlAvailability, policy.version, policy.active, policy.focus, policy.homeStyle,
    agent.homeLevel, agent.homeStyle, agent.construction ? JSON.stringify(agent.construction) : null, agent.lastGreetingTick,
    inventory.wood.total, inventory.wood.reserved, inventory.stone.total, inventory.stone.reserved, inventory.food.total, inventory.food.reserved,
    JSON.stringify(agent.needs), JSON.stringify(agent.decor), agent.coins, agent.offer ? JSON.stringify(agent.offer) : null,
  ];
}

const DECOR_REFUSALS: Readonly<Record<"ALREADY_OWNED" | "DECOR_FULL" | "CANT_AFFORD", string>> = {
  ALREADY_OWNED: "This home already has that decoration.",
  DECOR_FULL: "This home has no room for another decoration.",
  CANT_AFFORD: "This Chog's free stores can't pay for that decoration.",
};

const ACTION_MESSAGES: Readonly<Record<string, string>> = {
  LOGIN_REQUIRED: "Join the city first.", NOT_A_CITIZEN: "Join the city first.", NOT_CONTROLLER: "Only the Chog's current holder can do this.",
  CONTROL_CHANGED: "This Chog changed hands since the page was loaded; reload and try again.", NOT_FOUND: "That resident is no longer in the village.",
  IDEMPOTENCY_CONFLICT: "This Idempotency-Key was already used for a different request.", NOT_ENOUGH: "Not enough to pay for that.",
  NO_ROOM: "No room in the stores for that.", TREASURY_EMPTY: "The treasury can't pay for that right now.",
  MARKET_EMPTY: "The market doesn't have that much in stock.", NO_OFFER: "That job offer was withdrawn.", OFFER_TAKEN: "Someone else already took that job.",
  NOT_NEEDED: "The project needs no more of that.", NOT_ALLOWED: "That isn't allowed.",
  CANT_VOTE_YET: "Villagers can vote after working on 3 different village days.", VOTE_CLOSED: "That vote has closed.",
  TOO_MANY_PROPOSALS: "Too many proposals are open: one per Chog and five for the city.",
};

const placeholders = (from: number, count: number) => Array.from({ length: count }, (_, index) => `$${from + index}`).join(", ");
const tokenOf = (chainId: string, collection: string, tokenId: string) => `${chainId}:${collection.toLowerCase()}:${tokenId}`;

/** Revisions are allocated inside the transaction that holds the city_runtime row lock. */
class Tx {
  constructor(readonly db: Db, public revision: bigint, readonly nowMs: number) {}
  async emit(type: CityEventType, data: { readonly tick: string; readonly changes: readonly PublicChange[] } & Record<string, unknown>): Promise<void> {
    this.revision += 1n;
    await this.db.query("INSERT INTO city_events (revision, type, data, created_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))",
      [this.revision.toString(), type, JSON.stringify(data), this.nowMs]);
  }
}

export interface PgCityOptions {
  readonly pool: pg.Pool;
  readonly reader: ChainReader;
  /** Scheduling time in ms. Defaults to the database clock; tests inject a manual clock. */
  readonly now?: () => number | Promise<number>;
  /** Names this village; a database made for another city is refused. Defaults to City's world file. */
  readonly cityId?: string;
}

/**
 * Chog City on PostgreSQL, running the City team's pure simulation (../city/src/simulation). Ownership reads
 * happen before any lock; every change then locks the single `city_runtime` row, re-checks it, and commits
 * residents, ledger, tick record and events together.
 */
export class PgCity {
  readonly #pool: pg.Pool;
  readonly #reader: ChainReader;
  readonly #now: (() => number | Promise<number>) | undefined;
  readonly #cityId: string;

  constructor(options: PgCityOptions) {
    this.#pool = options.pool;
    this.#reader = options.reader;
    this.#now = options.now;
    this.#cityId = options.cityId ?? FIXTURE_CITY_ID;
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
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async #lockRuntime(db: Db): Promise<RuntimeRow> {
    const { rows } = await db.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1 FOR UPDATE");
    if (!rows[0]) throw new Error("Chog City is not initialized.");
    return rows[0];
  }

  async #loadWorld(db: Db, runtime: RuntimeRow): Promise<WorldState> {
    const { rows } = await db.query<AgentRow>("SELECT * FROM city_agents ORDER BY agent_key FOR UPDATE");
    const citizens = (await db.query<CitizenRow>("SELECT * FROM city_citizens ORDER BY citizen_key FOR UPDATE")).rows;
    return worldOf(runtime, rows, citizens);
  }

  /** Stores every resident, citizen and city-wide value (rules, treasury, projects) that differs from `before`. */
  async #saveChanged(db: Db, before: WorldState, after: WorldState): Promise<void> {
    const previous = new Map(before.agents.map((agent) => [agent.key, hashJson(agent)]));
    for (const agent of after.agents) {
      if (previous.get(agent.key) === hashJson(agent)) continue;
      await db.query(`UPDATE city_agents SET (${STATE_COLUMNS.join(", ")}) = ROW(${placeholders(2, STATE_COLUMNS.length)}) WHERE agent_key = $1`,
        [agent.key, ...stateValues(agent)]);
    }
    const citizensBefore = new Map(before.citizens.map((c) => [c.key, hashJson(c)]));
    for (const citizen of after.citizens) {
      const was = citizensBefore.get(citizen.key);
      if (was === hashJson(citizen)) continue;
      if (was === undefined) {
        await db.query(`INSERT INTO city_citizens (citizen_key, ${CITIZEN_COLUMNS.join(", ")}) VALUES (${placeholders(1, 1 + CITIZEN_COLUMNS.length)})`,
          [citizen.key, ...citizenValues(citizen)]);
      } else {
        await db.query(`UPDATE city_citizens SET (${CITIZEN_COLUMNS.join(", ")}) = ROW(${placeholders(2, CITIZEN_COLUMNS.length)}) WHERE citizen_key = $1`,
          [citizen.key, ...citizenValues(citizen)]);
      }
    }
    const city = (w: WorldState) => hashJson([w.params, w.treasury, w.projects, w.proposals, w.proposalSeq]);
    if (city(before) !== city(after)) {
      await db.query("UPDATE city_runtime SET params = $1, treasury = $2, projects = $3, proposals = $4, proposal_seq = $5 WHERE id = 1",
        [JSON.stringify(after.params), JSON.stringify(after.treasury), JSON.stringify(after.projects), JSON.stringify(after.proposals), after.proposalSeq]);
    }
  }

  async #writeAccounts(db: Db, tick: string, entries: readonly AccountEntry[]): Promise<void> {
    for (const e of entries) {
      await db.query(
        "INSERT INTO city_accounts (tick, account, asset, delta, cause_id, line_id, reason) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [tick, e.account, e.asset, e.delta, e.causeId, e.lineId, e.reason]);
    }
  }

  async #writeLedger(db: Db, tick: string, entries: readonly LedgerEntry[]): Promise<void> {
    for (const entry of entries) {
      await db.query(
        "INSERT INTO city_ledger (tick, agent_key, resource, total_delta, reserved_delta, cause_id, line_id, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        [tick, entry.agentKey, entry.resource, entry.totalDelta, entry.reservedDelta, entry.causeId, entry.lineId, entry.reason]);
    }
  }

  /** Reconciles ownership readings into a locked world, publishing each real change. */
  async #applyObservations(tx: Tx, world: WorldState, observations: ReadonlyMap<string, ControlObservation>): Promise<WorldState> {
    for (const agent of world.agents) {
      const observation = observations.get(agent.key);
      if (!observation) continue;
      const result = applyControlChange(world, agent.key, cityObservation(observation, tx.nowMs));
      if (result.world === world) continue;
      await this.#writeLedger(tx.db, world.tick, result.ledger);
      await tx.emit("control_changed", { tick: world.tick, changes: result.changes });
      world = result.world;
    }
    return world;
  }

  async #observe(agentKeys?: readonly string[]): Promise<Map<string, ControlObservation>> {
    const { rows } = await this.#pool.query<{ agent_key: string; identity: CityIdentity }>(
      `SELECT agent_key, identity FROM city_agents ${agentKeys ? "WHERE agent_key = ANY($1)" : ""} ORDER BY agent_key`, agentKeys ? [agentKeys] : []);
    return new Map(await Promise.all(rows.map(async (row) => [row.agent_key, await this.#reader.resolveAgent(cultIdentity(row.identity))] as const)));
  }

  /** Creates the runtime row once. Later starts adopt the current ruleset; a database for another city is refused. */
  async initialize(): Promise<void> {
    const now = await this.#clock();
    await this.#pool.query(
      `INSERT INTO city_runtime (id, city_id, seed, ruleset_version, tick, next_due_at) VALUES (1, $1, $2, $3, 0, to_timestamp($4 / 1000.0))
       ON CONFLICT (id) DO UPDATE SET ruleset_version = EXCLUDED.ruleset_version
       WHERE city_runtime.city_id = EXCLUDED.city_id AND city_runtime.ruleset_version <> EXCLUDED.ruleset_version`,
      [this.#cityId, `${this.#cityId}:1`, RULESET_VERSION, now + TICK_MS]);
    const { rows } = await this.#pool.query<{ city_id: string }>("SELECT city_id FROM city_runtime WHERE id = 1");
    if (rows[0]?.city_id !== this.#cityId) {
      throw new Error(`This database holds the City "${rows[0]?.city_id}", not "${this.#cityId}". Use a database dedicated to this City.`);
    }
    // Found the city's economy once: the constitution's defaults, the founding treasury (on the books) and
    // empty projects. Later starts leave whatever votes and trade have made of them.
    await this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      if (runtime.treasury === null) {
        await db.query("UPDATE city_runtime SET treasury = $1 WHERE id = 1", [JSON.stringify({ coins: GENESIS_TREASURY_COINS, stores: { wood: 0, stone: 0, food: 0 } })]);
        await this.#writeAccounts(db, String(runtime.tick), [accountEntry("treasury", "genesis", "coins", "grant", GENESIS_TREASURY_COINS)]);
      }
      if (runtime.params === null) await db.query("UPDATE city_runtime SET params = $1 WHERE id = 1", [JSON.stringify({ version: "1", values: defaultParams() })]);
      if (runtime.projects === null) await db.query("UPDATE city_runtime SET projects = $1 WHERE id = 1", [JSON.stringify(emptyProjects())]);
      if (runtime.proposals === null) await db.query("UPDATE city_runtime SET proposals = '[]' WHERE id = 1");
    });
  }

  /** Inserts a new resident on a free plot with the one-time grant. The caller holds the runtime lock. */
  async #settle(tx: Tx, tick: string, identity: CityIdentity, name: string, plotId: string, observation: Exclude<CityObservation, { reason: string }>): Promise<AgentState> {
    const key = makeCityAgentKey(identity);
    // One cause per NFT, so the grant can never be paid twice, whatever agent the token arrives as.
    const causeId = `admission:${tokenOf(identity.chainId, identity.collection, identity.tokenId)}`;
    const ledger = RESOURCES.filter((resource) => ADMISSION_GRANT[resource] > 0)
      .map((resource) => ledgerLine(key, causeId, resource, "admission", ADMISSION_GRANT[resource], 0));
    const agent: AgentState = {
      key, identity, name,
      control: {
        kind: "controlled", controller: observation.controller!.toLowerCase(), epoch: observation.epoch, projectionGeneration: observation.projectionGeneration,
        blockNumber: observation.blockNumber, blockHash: observation.blockHash, observedAtMs: observation.observedAtMs,
      },
      controlAvailability: "verified", plotId, location: { kind: "plot", plotId },
      policy: { version: "1", active: true, focus: "builder", homeStyle: DEFAULT_HOME_STYLE },
      inventory: {
        wood: { total: ADMISSION_GRANT.wood, reserved: 0 }, stone: { total: ADMISSION_GRANT.stone, reserved: 0 }, food: { total: ADMISSION_GRANT.food, reserved: 0 },
      },
      homeLevel: 0, homeStyle: DEFAULT_HOME_STYLE, construction: null, lastGreetingTick: null,
      needs: { energy: NEED_START, hunger: NEED_START, fun: NEED_START, social: NEED_START }, decor: [], coins: 0, offer: null,
    };
    await tx.db.query(
      `INSERT INTO city_agents (agent_key, identity, chain_id, collection, token_id, name, plot_id, admitted_tick, ${STATE_COLUMNS.join(", ")})
       VALUES (${placeholders(1, 8 + STATE_COLUMNS.length)})`,
      [key, JSON.stringify(identity), identity.chainId, identity.collection, identity.tokenId, name, plotId, tick, ...stateValues(agent)]);
    await this.#writeLedger(tx.db, tick, ledger);
    await tx.emit("resident_admitted", { tick, changes: [], agentKey: key, plotId });
    return agent;
  }

  /**
   * Admits server-configured Chogs (fixture or roster) once each: first free plot in plot order and the
   * one-time grant. Chogs already living in City are left alone; burned or unbound ones are skipped, and
   * when the plots run out the rest are reported as full.
   */
  async admitRoster(arrivals: readonly Arrival[]): Promise<{ admitted: string[]; full: string[]; skipped: string[] }> {
    const observed = await Promise.all(arrivals.map(async (arrival) => [arrival, await this.#reader.resolveAgent(arrival.identity)] as const));
    const unavailable = observed.find(([, observation]) => observation.kind === "unavailable");
    if (unavailable) throw new Error(`Cannot admit ${unavailable[0].name}: ownership is unavailable.`);
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const existing = (await db.query<{ agent_key: string; plot_id: string; chain_id: string; collection: string; token_id: string }>(
        "SELECT agent_key, plot_id, chain_id, collection, token_id FROM city_agents")).rows;
      const taken = new Set(existing.map((row) => row.plot_id));
      const keys = new Set(existing.map((row) => row.agent_key));
      const tokens = new Set(existing.map((row) => tokenOf(row.chain_id, row.collection, row.token_id)));
      const result = { admitted: [] as string[], full: [] as string[], skipped: [] as string[] };
      const ordered = observed.map(([arrival, observation]) => ({ arrival, observation, identity: cityIdentity(arrival.identity) }))
        .map((entry) => ({ ...entry, key: makeCityAgentKey(entry.identity) }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const { arrival, observation, identity, key } of ordered) {
        const token = tokenOf(identity.chainId, identity.collection, identity.tokenId);
        if (keys.has(key) || tokens.has(token)) continue;
        const reading = cityObservation(observation, now);
        if (reading.status !== "controlled") { result.skipped.push(key); continue; }
        const plot = CITY_PLOTS.find((entry) => !taken.has(entry.id));
        if (!plot) { result.full.push(key); continue; }
        await this.#settle(tx, String(runtime.tick), identity, arrival.name, plot.id, reading);
        taken.add(plot.id); keys.add(key); tokens.add(token);
        result.admitted.push(key);
      }
      await db.query("UPDATE city_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      return result;
    });
  }

  /**
   * A holder brings their own awakened Chog into City. Asking again returns the resident it already is.
   * Refused for anyone but the current holder, while ownership can't be read, or when every plot is taken.
   */
  async admitByHolder(actor: string, arrival: Arrival): Promise<CityResult<AgentState>> {
    const observation = await this.#reader.resolveAgent(arrival.identity);
    const identity = cityIdentity(arrival.identity);
    const key = makeCityAgentKey(identity);
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      const existing = (await db.query<AgentRow>(
        "SELECT * FROM city_agents WHERE agent_key = $1 OR (chain_id = $2 AND collection = $3 AND token_id = $4)",
        [key, identity.chainId, identity.collection, identity.tokenId])).rows[0];
      if (existing && existing.agent_key !== key) return { ok: false, code: "INVALID_INPUT", message: "This Chog already lives in City as another agent." } as const;
      const reading = cityObservation(observation, now);
      if (reading.status === "unavailable") return { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership can't be checked right now; try again shortly." } as const;
      if (reading.status === "burned") return { ok: false, code: "INVALID_INPUT", message: "This Chog was burned." } as const;
      if (reading.status === "unbound") return { ok: false, code: "NOT_AWAKENED", message: "Awaken this Chog first: it has no agent under the Chog adapter yet." } as const;
      if (reading.controller !== actor.toLowerCase()) return { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can do this." } as const;
      if (existing) return { ok: true, value: toAgent(existing) } as const;
      const taken = new Set((await db.query<{ plot_id: string }>("SELECT plot_id FROM city_agents")).rows.map((row) => row.plot_id));
      const plot = CITY_PLOTS.find((entry) => !taken.has(entry.id));
      if (!plot) return { ok: false, code: "CITY_FULL", message: `Every one of City's ${CITY_PLOTS.length} plots is taken.` } as const;
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const agent = await this.#settle(tx, String(runtime.tick), identity, arrival.name, plot.id, reading);
      await db.query("UPDATE city_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      return { ok: true, value: agent } as const;
    });
  }

  /**
   * Runs the due ticks: at most three after downtime, recording the rest as a gap. Safe to call from
   * several processes; only one applies a given tick.
   */
  async step(): Promise<CityStepOutcome> {
    const { rows } = await this.#pool.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1");
    const captured = rows[0];
    if (!captured) throw new Error("Chog City is not initialized.");
    const now = await this.#clock();
    const dueAt = captured.next_due_at.getTime();
    if (now < dueAt) return { kind: "not_due", nextDueAtMs: dueAt };
    // Ownership reads may be slow or fail; they happen before the lock.
    const observations = await this.#observe();

    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      if (runtime.tick !== captured.tick || runtime.next_due_at.getTime() !== dueAt) return { kind: "stale" } as const;
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const due = 1 + Math.floor((now - dueAt) / TICK_MS);
      const ran = Math.min(due, MAX_CATCH_UP_TICKS);
      const skipped = due - ran;
      const loaded = await this.#loadWorld(db, runtime);
      let world = await this.#applyObservations(tx, loaded, observations);
      if (skipped > 0) {
        // Downtime is a disclosed pause: skipped ticks are recorded, never simulated.
        await tx.emit("simulation_gap", { tick: world.tick, changes: [], skippedTicks: skipped });
      }
      for (let index = 0; index < ran; index++) {
        const result = step({ world });
        const tick = result.world.tick;
        await this.#writeLedger(db, tick, result.ledger);
        await this.#writeAccounts(db, tick, result.accounts);
        await db.query(
          "INSERT INTO city_ticks (tick, ruleset_version, input_hash, result_hash, action_count, committed_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))",
          [tick, world.rulesetVersion, hashWorld(world), result.resultHash, result.actionCount, now]);
        await tx.emit("city_tick", { tick, changes: result.changes, activities: result.activities });
        world = result.world;
      }
      await this.#saveChanged(db, loaded, world);
      const nextDue = skipped > 0 ? now + TICK_MS : dueAt + ran * TICK_MS;
      await db.query("UPDATE city_runtime SET tick = $1, next_due_at = to_timestamp($2 / 1000.0), revision = $3 WHERE id = 1",
        [world.tick, nextDue, tx.revision.toString()]);
      return { kind: "advanced", tick: world.tick, ran, skipped } as const;
    });
  }

  /** Runs due ticks until none is due (bounded). */
  async runDue(maxSteps = 4): Promise<CityStepOutcome[]> {
    const outcomes: CityStepOutcome[] = [];
    for (let index = 0; index < maxSteps; index++) {
      const outcome = await this.step();
      outcomes.push(outcome);
      if (outcome.kind !== "advanced") break;
    }
    return outcomes;
  }

  /**
   * A holder's Run/Pause, Focus and Home Style. Needs the current controller, the expected ownership epoch
   * and policy version; a no-op save changes nothing, a real change cancels unfinished construction.
   */
  async setPolicy(actor: string, agentKey: string, request: PolicyRequest, options: PolicyOptions): Promise<CityResult<AgentState>> {
    return this.#holderChange(actor, agentKey, "policy", options.expectedEpoch, options.idempotency, async (tx, world, agent) => {
      if (agent.policy.version !== options.expectedVersion) return { ok: false, code: "POLICY_CHANGED", message: "These settings changed since the form was loaded; reload and try again." };
      const change = applyPolicyChange(world, agentKey, request);
      if (change.world === world) return { ok: true, world };
      await this.#writeLedger(tx.db, world.tick, change.ledger);
      await tx.emit("policy_changed", { tick: world.tick, changes: change.changes });
      return { ok: true, world: change.world };
    });
  }

  /** A holder buys a decoration for the Chog's home, paid from its own free stores (City's applyDecor). */
  async decorate(actor: string, agentKey: string, item: DecorId, options: DecorOptions): Promise<CityResult<AgentState>> {
    return this.#holderChange(actor, agentKey, "decor", options.expectedEpoch, options.idempotency, async (tx, world) => {
      const decorated = applyDecor(world, agentKey, item, `decor:${agentKey}:${item}`);
      if (!decorated.ok) return { ok: false, code: decorated.code, message: DECOR_REFUSALS[decorated.code] };
      await this.#writeLedger(tx.db, world.tick, decorated.ledger);
      await tx.emit("home_decorated", { tick: world.tick, changes: decorated.changes });
      return { ok: true, world: decorated.world };
    });
  }

  /**
   * A holder's change to one resident: ownership is read first, then under the runtime lock the current
   * controller and expected epoch are checked before `apply` runs. Answers are replayed by Idempotency-Key.
   */
  async #holderChange(
    actor: string, agentKey: string, operation: "policy" | "decor", expectedEpoch: string, idem: Idempotency | undefined,
    apply: (tx: Tx, world: WorldState, agent: AgentState) => Promise<{ ok: true; world: WorldState } | { ok: false; code: CityErrorCode; message: string }>,
  ): Promise<CityResult<AgentState>> {
    const observation = (await this.#observe([agentKey])).get(agentKey);
    if (!observation) return { ok: false, code: "NOT_FOUND", message: "That Chog does not live in City." };
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      if (idem) {
        const { rows } = await db.query<{ request_hash: string; response: CityResult<AgentState> }>(
          "SELECT request_hash, response FROM city_idempotency WHERE session_id = $1 AND agent_key = $2 AND operation = $3 AND key = $4",
          [idem.sessionId, agentKey, operation, idem.key]);
        if (rows[0]) {
          return rows[0].request_hash === idem.requestHash ? rows[0].response
            : { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used for a different request." } as const;
        }
      }
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const loaded = await this.#loadWorld(db, runtime);
      let world = await this.#applyObservations(tx, loaded, new Map([[agentKey, observation]]));
      const agent = world.agents.find((entry) => entry.key === agentKey)!;
      let outcome: CityResult<AgentState>;
      if (agent.controlAvailability === "unavailable") outcome = { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership can't be checked right now; try again shortly." };
      else if (agent.control.kind !== "controlled" || agent.control.controller !== actor.toLowerCase()) outcome = { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can do this." };
      else if (agent.control.epoch !== expectedEpoch) outcome = { ok: false, code: "CONTROL_CHANGED", message: "This Chog changed hands since the form was loaded; reload and try again." };
      else {
        const applied = await apply(tx, world, agent);
        if (applied.ok) {
          world = applied.world;
          outcome = { ok: true, value: world.agents.find((entry) => entry.key === agentKey)! };
        } else outcome = applied;
      }
      await this.#saveChanged(db, loaded, world);
      await db.query("UPDATE city_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      // A transient outage is not a final answer; the same key may be retried and succeed.
      if (idem && !(!outcome.ok && outcome.code === "OWNERSHIP_UNAVAILABLE")) {
        await db.query(
          "INSERT INTO city_idempotency (session_id, agent_key, operation, key, request_hash, response, created_at) VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))",
          [idem.sessionId, agentKey, operation, idem.key, idem.requestHash, JSON.stringify(outcome), now]);
      }
      return outcome;
    });
  }

  /** The signed-in player's villager, or undefined. */
  async citizen(address: string): Promise<CitizenState | undefined> {
    const { rows } = await this.#pool.query<CitizenRow>("SELECT * FROM city_citizens WHERE address = $1", [address.toLowerCase()]);
    return rows[0] ? toCitizen(rows[0]) : undefined;
  }

  /** Anyone signed in joins with a villager: first free lot and the starting grant. Joining again returns the same villager. */
  async joinCity(actor: string, request: JoinRequest, idempotency: Idempotency): Promise<CityResult<CitizenState>> {
    return this.#playerChange("join", idempotency, [], (world) => {
      const joined = admitCitizen(world, { address: actor, name: request.name, look: request.look });
      if (!joined.ok) return { ok: false, code: "DISTRICT_FULL", message: "Newcomers' Row is full. New lots open as the city grows." };
      return { ok: true, world: joined.world, ledger: [], accounts: joined.accounts, changes: joined.changes, event: "citizen_joined", value: (w) => w.citizens.find((c) => c.key === joined.citizen.key)! };
    });
  }

  /** The signed-in citizen's job for the city (this also leaves any Chog employer). */
  async setJob(actor: string, request: JobRequest, idempotency: Idempotency): Promise<CityResult<CitizenState>> {
    const key = citizenKeyOf(actor);
    return this.#playerChange("job", idempotency, [], (world) => {
      const citizen = world.citizens.find((c) => c.key === key);
      if (!citizen) return { ok: false, code: "NOT_A_CITIZEN", message: "Join the city first." };
      if (citizen.jobVersion !== request.expectedVersion) return { ok: false, code: "JOB_CHANGED", message: "Your job changed somewhere else first; pick again." };
      const changed = applyJobChange(world, key, request.job);
      return { ok: true, world: changed.world, ledger: [], accounts: [], changes: changed.changes, event: "job_changed", value: (w) => w.citizens.find((c) => c.key === key)! };
    });
  }

  /**
   * Gifts, market trades, job offers, taking an offer and project contributions. Every Chog that pays or
   * posts is re-read from the chain first, so a seller can't act after the sale.
   */
  async act(actor: string, action: CityAction, idempotency: Idempotency): Promise<CityResult<true>> {
    const paying = action.type === "trade" || action.type === "offer" || action.type === "propose" ? [action.chog]
      : (action.type === "gift" || action.type === "contribute") && action.from.kind === "chog" ? [action.from.key] : [];
    return this.#playerChange("act", idempotency, paying, (world) => {
      const applied = applyAction(world, actor, action, `act:${idempotency.sessionId}:${idempotency.key}`);
      if (!applied.ok) {
        const code: CityErrorCode = applied.code === "LOGIN_REQUIRED" ? "NOT_A_CITIZEN" : applied.code;
        return { ok: false, code, message: ACTION_MESSAGES[applied.code] ?? "That isn't allowed." };
      }
      return { ok: true, world: applied.world, ledger: applied.ledger, accounts: applied.accounts, changes: applied.changes, event: "city_action" as const, value: (): true => true };
    });
  }

  /** Shared path for player changes: ownership reads first, then under the runtime lock apply, book, emit and replay by key. */
  async #playerChange<T>(
    operation: "join" | "job" | "act", idem: Idempotency, observeKeys: readonly string[],
    apply: (world: WorldState) =>
      | { ok: true; world: WorldState; ledger: LedgerEntry[]; accounts: AccountEntry[]; changes: PublicChange[]; event: CityEventType; value: (world: WorldState) => T }
      | { ok: false; code: CityErrorCode; message: string },
  ): Promise<CityResult<T>> {
    const observations = observeKeys.length ? await this.#observe(observeKeys) : new Map<string, ControlObservation>();
    if (observeKeys.some((key) => !observations.has(key))) return { ok: false, code: "NOT_FOUND", message: "That Chog does not live in City." };
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      const { rows } = await db.query<{ request_hash: string; response: CityResult<T> }>(
        "SELECT request_hash, response FROM city_player_idempotency WHERE session_id = $1 AND operation = $2 AND key = $3", [idem.sessionId, operation, idem.key]);
      if (rows[0]) {
        return rows[0].request_hash === idem.requestHash ? rows[0].response
          : { ok: false, code: "IDEMPOTENCY_CONFLICT", message: "This Idempotency-Key was already used for a different request." } as const;
      }
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const loaded = await this.#loadWorld(db, runtime);
      let world = await this.#applyObservations(tx, loaded, observations);
      const unavailable = observeKeys.some((key) => world.agents.find((a) => a.key === key)?.controlAvailability === "unavailable");
      let outcome: CityResult<T>;
      if (unavailable) outcome = { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership can't be checked right now; try again shortly." };
      else {
        const applied = apply(world);
        if (applied.ok) {
          await this.#writeLedger(db, world.tick, applied.ledger);
          await this.#writeAccounts(db, world.tick, applied.accounts);
          if (applied.world !== world) await tx.emit(applied.event, { tick: world.tick, changes: applied.changes });
          world = applied.world;
          outcome = { ok: true, value: applied.value(world) };
        } else outcome = applied;
      }
      await this.#saveChanged(db, loaded, world);
      await db.query("UPDATE city_runtime SET revision = $1 WHERE id = 1", [tx.revision.toString()]);
      if (!(!outcome.ok && outcome.code === "OWNERSHIP_UNAVAILABLE")) {
        await db.query(
          "INSERT INTO city_player_idempotency (session_id, operation, key, request_hash, response, created_at) VALUES ($1, $2, $3, $4, $5, to_timestamp($6 / 1000.0))",
          [idem.sessionId, operation, idem.key, idem.requestHash, JSON.stringify(outcome), now]);
      }
      return outcome;
    });
  }

  // ---- The council ---------------------------------------------------------------------------

  /** A holder reads their own Chog's standing instructions (ownership read fresh). */
  async getInstructions(actor: string, agentKey: string): Promise<CityResult<string | null>> {
    const observation = (await this.#observe([agentKey])).get(agentKey);
    if (!observation) return { ok: false, code: "NOT_FOUND", message: "That Chog does not live in City." };
    if (observation.kind === "unavailable") return { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership can't be checked right now; try again shortly." };
    if (observation.kind !== "controlled" || observation.controller.toLowerCase() !== actor.toLowerCase()) return { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can read its instructions." };
    const { rows } = await this.#pool.query<{ text: string }>("SELECT text FROM city_instructions WHERE agent_key = $1 AND ownership_epoch = $2", [agentKey, observation.ownershipEpoch]);
    return { ok: true, value: rows[0]?.text ?? null };
  }

  /** A holder sets (or, with empty text, clears) their Chog's standing instructions for this ownership epoch. */
  async setInstructions(actor: string, agentKey: string, request: { expectedEpoch: string; text: string }): Promise<CityResult<string>> {
    const observation = (await this.#observe([agentKey])).get(agentKey);
    if (!observation) return { ok: false, code: "NOT_FOUND", message: "That Chog does not live in City." };
    if (observation.kind === "unavailable") return { ok: false, code: "OWNERSHIP_UNAVAILABLE", message: "Ownership can't be checked right now; try again shortly." };
    if (observation.kind !== "controlled" || observation.controller.toLowerCase() !== actor.toLowerCase()) return { ok: false, code: "NOT_CONTROLLER", message: "Only the Chog's current holder can instruct it." };
    if (observation.ownershipEpoch !== request.expectedEpoch) return { ok: false, code: "CONTROL_CHANGED", message: "This Chog changed hands since the page was loaded; reload and try again." };
    const text = request.text.trim();
    if (!text) await this.#pool.query("DELETE FROM city_instructions WHERE agent_key = $1", [agentKey]);
    else {
      await this.#pool.query(
        `INSERT INTO city_instructions (agent_key, ownership_epoch, text, updated_at) VALUES ($1, $2, $3, to_timestamp($4 / 1000.0))
         ON CONFLICT (agent_key) DO UPDATE SET ownership_epoch = EXCLUDED.ownership_epoch, text = EXCLUDED.text, updated_at = EXCLUDED.updated_at`,
        [agentKey, observation.ownershipEpoch, text, await this.#clock()]);
    }
    return { ok: true, value: text };
  }

  /**
   * When a council session is due (the current tick is the council hour and none was held for it), the world
   * and every Chog's standing instructions for its current epoch, for the minds to decide on. Read-only.
   */
  async councilPlan(): Promise<{ tick: string; world: WorldState; instructions: Map<string, string> } | null> {
    const runtime = (await this.#pool.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1")).rows[0];
    if (!runtime || !councilDue(String(runtime.tick))) return null;
    if (runtime.last_council_tick !== null && BigInt(runtime.last_council_tick) >= BigInt(runtime.tick)) return null;
    const agents = (await this.#pool.query<AgentRow>("SELECT * FROM city_agents ORDER BY agent_key")).rows;
    const citizens = (await this.#pool.query<CitizenRow>("SELECT * FROM city_citizens ORDER BY citizen_key")).rows;
    const world = worldOf(runtime, agents, citizens);
    const { rows } = await this.#pool.query<{ agent_key: string; ownership_epoch: string; text: string }>("SELECT agent_key, ownership_epoch, text FROM city_instructions");
    const epochs = new Map(world.agents.map((a) => [a.key, a.control.epoch]));
    const instructions = new Map(rows.filter((row) => epochs.get(row.agent_key) === String(row.ownership_epoch)).map((row) => [row.agent_key, row.text]));
    return { tick: String(runtime.tick), world, instructions };
  }

  /**
   * Holds a council session on the world as it is now (City's two-pass session: proposals, then speeches; every
   * part checked by City's rules), once per council tick, and lets `settle` charge or refund AI turns in the
   * same transaction. Returns the Chogs whose turn changed something, or null if this session was already held.
   */
  async applyCouncil(tick: string, seats: readonly CouncilSeat[], settle?: (db: Db, used: ReadonlySet<string>) => Promise<void>): Promise<ReadonlySet<string> | null> {
    const now = await this.#clock();
    return this.#transaction(async (db) => {
      const runtime = await this.#lockRuntime(db);
      if (runtime.last_council_tick !== null && BigInt(runtime.last_council_tick) >= BigInt(tick)) return null;
      const tx = new Tx(db, BigInt(runtime.revision), now);
      const loaded = await this.#loadWorld(db, runtime);
      const { world, changes, used } = runCouncilSession(loaded, seats);
      if (changes.length) await tx.emit("council", { tick: world.tick, changes });
      await this.#saveChanged(db, loaded, world);
      await db.query("UPDATE city_runtime SET revision = $1, last_council_tick = $2 WHERE id = 1", [tx.revision.toString(), tick]);
      if (settle) await settle(db, used);
      return used;
    });
  }

  async runtime(): Promise<{ tick: string; nextDueAtMs: number; revision: string }> {
    const { rows } = await this.#pool.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1");
    const row = rows[0];
    if (!row) throw new Error("Chog City is not initialized.");
    return { tick: String(row.tick), nextDueAtMs: row.next_due_at.getTime(), revision: String(row.revision) };
  }

  async agent(agentKey: string): Promise<AgentState | undefined> {
    const { rows } = await this.#pool.query<AgentRow>("SELECT * FROM city_agents WHERE agent_key = $1", [agentKey]);
    return rows[0] ? toAgent(rows[0]) : undefined;
  }

  /** Residents whose last verified controller is `address`. Settings still re-check ownership on save. */
  async agentsOf(address: string): Promise<AgentState[]> {
    const { rows } = await this.#pool.query<AgentRow>(
      "SELECT * FROM city_agents WHERE controller = $1 AND control_kind = 'controlled' ORDER BY agent_key", [address.toLowerCase()]);
    return rows.map(toAgent);
  }

  /** Checks that ledger sums equal every stored inventory. Returns the mismatches (empty when consistent). */
  async reconcile(): Promise<string[]> {
    const db = await this.#pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const runtime = (await db.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1")).rows[0]!;
      const agentRows = (await db.query<AgentRow>("SELECT * FROM city_agents ORDER BY agent_key")).rows;
      const agents = agentRows.map(toAgent);
      const citizenRows = (await db.query<CitizenRow>("SELECT * FROM city_citizens ORDER BY citizen_key")).rows;
      const sums = (await db.query<{ agent_key: string; resource: string; total: string; reserved: string }>(
        "SELECT agent_key, resource, sum(total_delta) AS total, sum(reserved_delta) AS reserved FROM city_ledger GROUP BY agent_key, resource")).rows;
      const books = (await db.query<{ account: string; asset: AccountEntry["asset"]; delta: string }>(
        "SELECT account, asset, sum(delta) AS delta FROM city_accounts GROUP BY account, asset")).rows
        .map((row) => ({ account: row.account, asset: row.asset, delta: Number(row.delta), causeId: "sum", lineId: "sum", reason: "grant" as const }));
      await db.query("COMMIT");
      const balance = new Map(sums.map((row) => [`${row.agent_key}|${row.resource}`, { total: Number(row.total), reserved: Number(row.reserved) }]));
      const problems: string[] = [];
      for (const agent of agents) {
        for (const resource of RESOURCES) {
          const sum = balance.get(`${agent.key}|${resource}`) ?? { total: 0, reserved: 0 };
          const stored = agent.inventory[resource];
          if (sum.total !== stored.total || sum.reserved !== stored.reserved) problems.push(`${agent.name} ${resource}: ledger ${sum.total}/${sum.reserved}, stored ${stored.total}/${stored.reserved}`);
        }
      }
      // Coins, the treasury and project funds, against city_accounts.
      problems.push(...reconcileAccounts(worldOf(runtime, agentRows, citizenRows), books));
      return problems;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
}
