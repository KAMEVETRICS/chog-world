// UI-only CityClient: runs the pure simulation in-process on a 10-second clock.
// Local dev/test only. It enforces the same policy fences the server will (version, epoch,
// controller, idempotency) so the UI is built against real failure modes from day one.
import type {
  InstructionsRequest,
  InstructionsResult,
  AccountEntry,
  ActionResult,
  CityAction,
  AgentKey,
  CitizenState,
  JobRequest,
  JobResult,
  JoinRequest,
  JoinResult,
  AgentState,
  CityClient,
  CityEvent,
  CityEventType,
  CitySnapshot,
  PolicyUpdateRequest,
  PolicyUpdateResult,
  DecorateRequest,
  DecorateResult,
  TickResult,
  WorldState,
} from '../shared/contracts';
import { cityActionSchema, instructionsRequestSchema, decorateRequestSchema, jobRequestSchema, joinRequestSchema, policyUpdateRequestSchema } from '../shared/schemas';
import { applyAction } from '../simulation/economy';
import { councilDue, councilMembers, runCouncilSession } from '../simulation/council';
import { admitCitizen, applyJobChange, applyParamChange, citizenKeyOf } from '../simulation/citizens';
import { applyDecor } from '../simulation/needs';
import { DAY_TICKS, TICK_MS } from '../shared/rules';
import { applyControlChange, applyPolicyChange, hashJson, step } from '../simulation/step';
import { FIXTURE_ACTORS, fixtureGenesisAccounts, fixtureResident, makeFixtureWorld, type FixtureActorId } from './residents';

const RECENT_EVENTS = 60;

export interface FixtureClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const realClock: FixtureClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface FixtureClientOptions {
  world?: WorldState;
  clock?: FixtureClock;
  tickMs?: number;
  /** Start the village clock immediately (default true). */
  autoStart?: boolean;
}

export class FixtureCityClient implements CityClient {
  private world: WorldState;
  private revision = 0n;
  private events: CityEvent[] = [];
  private listeners = new Set<(event: CityEvent) => void>();
  private idempotency = new Map<string, { bodyHash: string; result: PolicyUpdateResult | DecorateResult | JoinResult | JobResult | ActionResult }>();
  /** Holders' standing instructions, by Chog, for the epoch they were given in. */
  private instructions = new Map<AgentKey, { epoch: string; text: string }>();
  /** Every coin and city-store movement since genesis, so tests can reconcile the books. */
  private accounts: AccountEntry[];
  private actor: FixtureActorId | null = 'A';
  private timer: unknown = null;
  private nextDueAt: number;
  private readonly clock: FixtureClock;
  private readonly tickMs: number;

  constructor(options: FixtureClientOptions = {}) {
    this.world = options.world ?? makeFixtureWorld({ lived: true });
    this.accounts = fixtureGenesisAccounts(this.world);
    this.clock = options.clock ?? realClock;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.nextDueAt = this.clock.now() + this.tickMs;
    if (options.autoStart ?? true) this.start();
  }

  readonly mode = 'fixture' as const;

  start(): void {
    if (this.timer !== null) return;
    this.nextDueAt = this.clock.now() + this.tickMs;
    this.timer = this.clock.setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer === null) return;
    this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Advance one tick now (used by the clock and by tests). */
  tick(): void {
    const result = step({ world: this.world });
    this.nextDueAt = this.clock.now() + this.tickMs;
    this.commit('city_tick', result);
    if (councilDue(this.world.tick)) this.council();
  }

  /** The morning council, with every Chog's rules-based mind (the fixture has no AI). */
  private council(): void {
    const seats = councilMembers(this.world).map((agent) => ({ agentKey: agent.key, instructions: this.instructionsFor(agent) }));
    const { world, changes } = runCouncilSession(this.world, seats);
    if (changes.length) this.commit('council', { world, ledger: [], accounts: [], changes, activities: [], actionCount: 0, resultHash: hashJson(world) });
  }

  private instructionsFor(agent: AgentState): string | null {
    const saved = this.instructions.get(agent.key);
    return saved && saved.epoch === agent.control.epoch ? saved.text : null;
  }

  // ---- CityClient ------------------------------------------------------------------------

  async getSnapshot(): Promise<CitySnapshot> {
    return {
      revision: this.revision.toString(),
      tick: this.world.tick,
      nextDueAt: new Date(this.nextDueAt).toISOString(),
      world: this.world,
      recentEvents: this.events.slice(-RECENT_EVENTS),
    };
  }

  async getAgent(key: AgentKey): Promise<AgentState | null> {
    return this.world.agents.find((a) => a.key === key) ?? null;
  }

  async getMyAgents(): Promise<AgentState[]> {
    if (!this.actor) return [];
    const me = FIXTURE_ACTORS[this.actor].address.toLowerCase();
    return this.world.agents.filter((a) => a.control.kind === 'controlled' && a.control.controller?.toLowerCase() === me);
  }

  async updatePolicy(key: AgentKey, request: PolicyUpdateRequest, idempotencyKey: string): Promise<PolicyUpdateResult> {
    const body = policyUpdateRequestSchema.parse(request);
    if (!this.actor) return { ok: false, code: 'NOT_CONTROLLER' };
    const scope = `${this.actor}:${key}:${idempotencyKey}`;
    const bodyHash = hashJson(body);
    const previous = this.idempotency.get(scope);
    if (previous) return previous.bodyHash === bodyHash ? (previous.result as PolicyUpdateResult) : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };

    const result = this.applyPolicy(key, body);
    this.idempotency.set(scope, { bodyHash, result });
    return result;
  }

  async decorate(key: AgentKey, request: DecorateRequest, idempotencyKey: string): Promise<DecorateResult> {
    const body = decorateRequestSchema.parse(request);
    if (!this.actor) return { ok: false, code: 'NOT_CONTROLLER' };
    const scope = `decor:${this.actor}:${key}:${idempotencyKey}`;
    const bodyHash = hashJson(body);
    const previous = this.idempotency.get(scope);
    if (previous) return previous.bodyHash === bodyHash ? (previous.result as DecorateResult) : { ok: false, code: 'IDEMPOTENCY_CONFLICT' };

    const result = this.applyDecoration(key, body);
    this.idempotency.set(scope, { bodyHash, result });
    return result;
  }

  async getMyCitizen(): Promise<CitizenState | null> {
    if (!this.actor) return null;
    const key = citizenKeyOf(FIXTURE_ACTORS[this.actor].address);
    return this.world.citizens.find((c) => c.key === key) ?? null;
  }

  async joinCity(request: JoinRequest, idempotencyKey: string): Promise<JoinResult> {
    const body = joinRequestSchema.parse(request);
    if (!this.actor) return { ok: false, code: 'LOGIN_REQUIRED' };
    return this.once(`join:${this.actor}:${idempotencyKey}`, body, () => {
      const joined = admitCitizen(this.world, { address: FIXTURE_ACTORS[this.actor!].address, name: body.name, look: body.look });
      if (!joined.ok) return joined;
      if (joined.world !== this.world) this.commit('citizen_joined', { ...joined, ledger: [], activities: [], actionCount: 0, resultHash: hashJson(joined.world) });
      return { ok: true, citizen: joined.citizen };
    });
  }

  async setJob(request: JobRequest, idempotencyKey: string): Promise<JobResult> {
    const body = jobRequestSchema.parse(request);
    if (!this.actor) return { ok: false, code: 'LOGIN_REQUIRED' };
    return this.once(`job:${this.actor}:${idempotencyKey}`, body, () => {
      const key = citizenKeyOf(FIXTURE_ACTORS[this.actor!].address);
      const citizen = this.world.citizens.find((c) => c.key === key);
      if (!citizen) return { ok: false, code: 'NOT_A_CITIZEN' };
      if (citizen.jobVersion !== body.expectedVersion) return { ok: false, code: 'JOB_CHANGED' };
      const changed = applyJobChange(this.world, key, body.job);
      if (changed.world !== this.world) this.commit('job_changed', { ...changed, ledger: [], activities: [], actionCount: 0, resultHash: hashJson(changed.world) });
      return { ok: true, citizen: this.world.citizens.find((c) => c.key === key)! };
    });
  }

  async act(action: CityAction, idempotencyKey: string): Promise<ActionResult> {
    const body = cityActionSchema.parse(action) as CityAction;
    if (!this.actor) return { ok: false, code: 'LOGIN_REQUIRED' };
    const scope = `act:${this.actor}:${idempotencyKey}`;
    return this.once(scope, body, (): ActionResult => {
      const applied = applyAction(this.world, FIXTURE_ACTORS[this.actor!].address, body, scope);
      if (!applied.ok) return applied;
      this.commit('city_action', { ...applied, activities: [], actionCount: 0, resultHash: hashJson(applied.world) });
      return { ok: true };
    });
  }

  async getInstructions(key: AgentKey): Promise<string | null> {
    const agent = this.world.agents.find((a) => a.key === key);
    if (!agent || !this.actor || agent.control.controller?.toLowerCase() !== FIXTURE_ACTORS[this.actor].address) return null;
    return this.instructionsFor(agent);
  }

  async setInstructions(key: AgentKey, request: InstructionsRequest): Promise<InstructionsResult> {
    const body = instructionsRequestSchema.parse(request);
    if (!this.actor) return { ok: false, code: 'LOGIN_REQUIRED' };
    const agent = this.world.agents.find((a) => a.key === key);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };
    if (agent.control.kind !== 'controlled' || agent.control.controller?.toLowerCase() !== FIXTURE_ACTORS[this.actor].address) return { ok: false, code: 'NOT_CONTROLLER' };
    if (agent.control.epoch !== body.expectedEpoch) return { ok: false, code: 'CONTROL_CHANGED' };
    const text = body.text.trim();
    if (text) this.instructions.set(key, { epoch: agent.control.epoch, text });
    else this.instructions.delete(key);
    return { ok: true, text };
  }

  subscribe(afterRevision: string, onEvent: (event: CityEvent) => void, onReset: () => void): () => void {
    const after = BigInt(afterRevision);
    const oldest = this.events[0] ? BigInt(this.events[0].revision) : this.revision + 1n;
    if (after < oldest - 1n && after < this.revision) {
      onReset();
    } else {
      for (const event of this.events) if (BigInt(event.revision) > after) onEvent(event);
    }
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  // ---- Fixture-only controls (never present in production) -------------------------------

  /** Fixture-only: run a whole village day now (votes close after one). */
  skipDay(): void {
    for (let i = 0; i < DAY_TICKS; i += 1) this.tick();
  }

  /**
   * A new Chog moves in, as when a holder brings one in on the server: the first free plot in the world file's
   * order, the admission grant, paused until its holder sets it going. Returns its name, or null when every plot
   * is taken.
   */
  welcomeChog(): string | null {
    const taken = new Set(this.world.agents.map((a) => a.plotId));
    const plot = this.world.plots.find((p) => !taken.has(p.id));
    if (!plot) return null;
    const resident = fixtureResident(this.world.agents.length, plot, true);
    const world = { ...this.world, agents: [...this.world.agents, resident] };
    this.commit('resident_admitted', { world, ledger: [], accounts: [], changes: [], activities: [], actionCount: 0, resultHash: hashJson(world) });
    return resident.name;
  }

  /** The books since genesis (copy). */
  accountLog(): AccountEntry[] {
    return this.accounts.slice();
  }

  /** Enacts a parameter change directly, as a passed vote will (votes come in the next step). */
  enactParams(proposal: Record<string, number>): { ok: true } | { ok: false; problems: string[] } {
    const enacted = applyParamChange(this.world, proposal);
    if (!enacted.ok) return enacted;
    this.commit('params_changed', { ...enacted, ledger: [], activities: [], actionCount: 0, resultHash: hashJson(enacted.world) });
    return { ok: true };
  }

  /** `null` is a signed-out visitor. */
  get currentActor(): FixtureActorId | null {
    return this.actor;
  }

  setActor(actor: FixtureActorId | null): void {
    this.actor = actor;
  }

  /** Simulated NFT transfer to the other fixture holder, via the shared control-change transition. */
  simulateTransfer(key: AgentKey): void {
    const agent = this.world.agents.find((a) => a.key === key);
    if (!agent || agent.control.kind !== 'controlled') return;
    const to = agent.control.controller?.toLowerCase() === FIXTURE_ACTORS.A.address ? FIXTURE_ACTORS.B : FIXTURE_ACTORS.A;
    const result = applyControlChange(this.world, key, {
      status: 'controlled',
      controller: to.address,
      epoch: (BigInt(agent.control.epoch) + 1n).toString(),
      projectionGeneration: (BigInt(agent.control.projectionGeneration) + 1n).toString(),
      blockNumber: this.world.tick,
      blockHash: `0x${hashJson([key, this.world.tick])}`,
      observedAtMs: this.clock.now(),
    });
    this.commit('control_changed', result);
  }

  // ---- internals -------------------------------------------------------------------------

  private applyPolicy(key: AgentKey, body: PolicyUpdateRequest): PolicyUpdateResult {
    const agent = this.world.agents.find((a) => a.key === key);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };
    const me = FIXTURE_ACTORS[this.actor!].address.toLowerCase();
    if (agent.control.kind !== 'controlled' || agent.control.controller?.toLowerCase() !== me) {
      return { ok: false, code: 'NOT_CONTROLLER' };
    }
    if (agent.control.epoch !== body.expectedEpoch) return { ok: false, code: 'CONTROL_CHANGED' };
    if (agent.policy.version !== body.expectedVersion) return { ok: false, code: 'POLICY_CHANGED' };

    const result = applyPolicyChange(this.world, key, body);
    if (result.world !== this.world) this.commit('policy_changed', result);
    return { ok: true, agent: this.world.agents.find((a) => a.key === key)! };
  }

  private applyDecoration(key: AgentKey, body: DecorateRequest): DecorateResult {
    const agent = this.world.agents.find((a) => a.key === key);
    if (!agent) return { ok: false, code: 'NOT_FOUND' };
    const me = FIXTURE_ACTORS[this.actor!].address.toLowerCase();
    if (agent.control.kind !== 'controlled' || agent.control.controller?.toLowerCase() !== me) {
      return { ok: false, code: 'NOT_CONTROLLER' };
    }
    if (agent.control.epoch !== body.expectedEpoch) return { ok: false, code: 'CONTROL_CHANGED' };
    const decorated = applyDecor(this.world, key, body.item, `decor:${key}:${body.item}`);
    if (!decorated.ok) return decorated;
    this.commit('home_decorated', { world: decorated.world, ledger: decorated.ledger, accounts: [], changes: decorated.changes, activities: [], actionCount: 0, resultHash: hashJson(decorated.world) });
    return { ok: true, agent: this.world.agents.find((a) => a.key === key)! };
  }

  /** Replays an earlier answer for the same idempotency key and body; a different body is a conflict. */
  private once<T extends JoinResult | JobResult | ActionResult>(scope: string, body: unknown, run: () => T): T {
    const bodyHash = hashJson(body);
    const previous = this.idempotency.get(scope);
    if (previous) return (previous.bodyHash === bodyHash ? previous.result : { ok: false, code: 'IDEMPOTENCY_CONFLICT' }) as T;
    const result = run();
    this.idempotency.set(scope, { bodyHash, result });
    return result;
  }

  private commit(type: CityEventType, result: Omit<TickResult, 'accounts'> & { accounts?: AccountEntry[] }): void {
    this.world = result.world;
    this.accounts.push(...(result.accounts ?? []));
    this.revision += 1n;
    const event: CityEvent = {
      revision: this.revision.toString(),
      type,
      data:
        type === 'city_tick'
          ? { tick: result.world.tick, changes: result.changes, activities: result.activities }
          : { tick: result.world.tick, changes: result.changes },
      createdAt: new Date(this.clock.now()).toISOString(),
    };
    this.events.push(event);
    if (this.events.length > RECENT_EVENTS * 4) this.events.splice(0, this.events.length - RECENT_EVENTS * 2);
    for (const listener of [...this.listeners]) listener(event);
  }
}
