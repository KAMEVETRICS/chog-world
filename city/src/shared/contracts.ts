// Frozen cross-file domain and DTO types (plan §1 "Shared contracts").
// All uint256 values (token/agent IDs, epochs, generations, ticks, revisions)
// are canonical decimal strings. Resource quantities are bounded integers.
import { addressSchema, uint256StringSchema } from './schemas';

export type Address = string;
export type Uint256 = string;

export interface AgentIdentity {
  chainId: Uint256;
  registry: Address;
  adapter: Address;
  collection: Address;
  tokenId: Uint256;
  agentId: Uint256;
}

export type AgentKey = string;

/** Full identity tuple; addresses lowercased so casing never creates a second key. */
export function makeAgentKey(identity: AgentIdentity): AgentKey {
  return [
    uint256StringSchema.parse(identity.chainId),
    addressSchema.parse(identity.registry).toLowerCase(),
    addressSchema.parse(identity.adapter).toLowerCase(),
    addressSchema.parse(identity.collection).toLowerCase(),
    uint256StringSchema.parse(identity.tokenId),
    uint256StringSchema.parse(identity.agentId),
  ].join(':');
}

export const RESOURCES = ['wood', 'stone', 'food'] as const;
export type Resource = (typeof RESOURCES)[number];
export type ResourceAmounts = Record<Resource, number>;
export interface InventoryLine {
  total: number;
  reserved: number;
}
export type Inventory = Record<Resource, InventoryLine>;

export const PLACE_IDS = ['plaza', 'tavern', 'workshop', 'forest', 'quarry', 'farm'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];
export type Location = { kind: 'place'; placeId: PlaceId } | { kind: 'plot'; plotId: string };

export interface Place {
  id: PlaceId;
  name: string;
  x: number;
  y: number;
}
export interface Plot {
  id: string;
  x: number;
  y: number;
}

/** Sims-style needs, each 0-100 (higher is better; hunger 100 means full). */
export const NEED_IDS = ['energy', 'hunger', 'fun', 'social'] as const;
export type Need = (typeof NEED_IDS)[number];
export type Needs = Record<Need, number>;

/** Decorations a holder can buy for their Chog's home (see DECOR in rules.ts). */
export const DECOR_IDS = ['lantern', 'flowerbed', 'bench', 'well'] as const;
export type DecorId = (typeof DECOR_IDS)[number];

/** Game numbers a vote can change, each bounded by the constitution (src/shared/constitution.ts). */
export const PARAM_IDS = ['farmYield', 'forestYield', 'quarryYield', 'wage', 'incomeTaxPct', 'marketFeePct'] as const;
export type ParamId = (typeof PARAM_IDS)[number];
export type Params = Record<ParamId, number>;
export interface ParamState {
  /** Bumped by every enacted change. */
  version: Uint256;
  values: Params;
}

/** The city's own purse and stores, filled by citizens' work and taxes. */
export interface Treasury {
  coins: number;
  stores: ResourceAmounts;
}

/** Jobs a citizen can take for the city. `off` stays home. */
export const JOBS = ['farmhand', 'woodcutter', 'quarrier', 'off'] as const;
export type Job = (typeof JOBS)[number];

/** A home lot in the citizens' district (Newcomers' Row). */
export interface Lot {
  id: string;
  x: number;
  y: number;
}

export type CitizenKey = string;
export type CitizenLocation = { kind: 'place'; placeId: PlaceId } | { kind: 'lot'; lotId: string };

/** How a citizen's Chog-like villager looks: Chog Genesis trait values from the allowed lists. */
export interface VillagerLook {
  Skin: string;
  Head: string;
  Body: string;
  Eyes: string;
}

/**
 * A player without a Chog NFT (or a holder playing in person). Played by their human: they pick the job,
 * the villager carries it out. Not an AI agent.
 */
export interface CitizenState {
  key: CitizenKey;
  address: Address;
  name: string;
  look: VillagerLook;
  lotId: string;
  location: CitizenLocation;
  job: Job;
  /** Bumped by every job change; stale forms are refused. */
  jobVersion: Uint256;
  coins: number;
  joinedTick: Uint256;
  /** Village days on which this citizen worked at least once. Voting needs a few. */
  activeDays: number;
  lastWorkedDay: number | null;
  /** The Chog this citizen works for, or null for the city. */
  employer: AgentKey | null;
}

/** A Chog's standing job offer: one citizen works the site for it, paid from the Chog's coins. */
export interface JobOffer {
  job: Exclude<Job, 'off'>;
  /** Coins per tick worked. */
  wage: number;
}

/** Shared projects everyone can chip in to (see PROJECTS in rules.ts). */
export const PROJECT_IDS = ['fountain', 'market_hall'] as const;
export type ProjectId = (typeof PROJECT_IDS)[number];
export type ProjectAmounts = ResourceAmounts & { coins: number };
export interface ProjectState {
  given: ProjectAmounts;
  completedTick: Uint256 | null;
}

export const FOCUSES = ['builder', 'gatherer', 'social'] as const;
export type Focus = (typeof FOCUSES)[number];
export const HOME_STYLES = ['cottage', 'workshop', 'treehouse'] as const;
export type HomeStyle = (typeof HOME_STYLES)[number];

export interface Policy {
  version: Uint256;
  active: boolean;
  focus: Focus;
  homeStyle: HomeStyle;
}

/** Canonical control projection. `controlled` has a controller; `burned`/`unbound` have none. */
export interface CanonicalControlState {
  kind: 'controlled' | 'burned' | 'unbound';
  controller: Address | null;
  epoch: Uint256;
  projectionGeneration: Uint256;
  blockNumber: Uint256;
  blockHash: string;
  observedAtMs: number;
}
export type ControlAvailability = 'verified' | 'unavailable';

/** What a ChainReader (or fixture) reports. `unavailable` is a transient freeze, never a burn. */
export type ControlObservation =
  | {
      status: 'controlled' | 'burned' | 'unbound';
      controller: Address | null;
      epoch: Uint256;
      projectionGeneration: Uint256;
      blockNumber: Uint256;
      blockHash: string;
      observedAtMs: number;
    }
  | { status: 'unavailable'; reason: string; observedAtMs: number };

export interface Construction {
  actionId: string;
  targetLevel: number;
  costs: ResourceAmounts;
  remainingTicks: number;
  policyVersion: Uint256;
  ownershipEpoch: Uint256;
  startedTick: Uint256;
}

export interface AgentState {
  key: AgentKey;
  identity: AgentIdentity;
  name: string;
  control: CanonicalControlState;
  controlAvailability: ControlAvailability;
  plotId: string;
  location: Location;
  policy: Policy;
  inventory: Inventory;
  homeLevel: number;
  homeStyle: HomeStyle;
  construction: Construction | null;
  lastGreetingTick: Uint256 | null;
  needs: Needs;
  /** Bought by its holders; stays with the home when the Chog changes hands. */
  decor: DecorId[];
  /** City money, earned at the market or from gifts; pays hired citizens. */
  coins: number;
  offer: JobOffer | null;
}

export interface WorldState {
  cityId: string;
  tick: Uint256;
  seed: string;
  rulesetVersion: string;
  places: Place[];
  plots: Plot[];
  agents: AgentState[];
  /** Citizens' district lots, from the world file. */
  lots: Lot[];
  citizens: CitizenState[];
  params: ParamState;
  treasury: Treasury;
  projects: Record<ProjectId, ProjectState>;
  /** Open proposals and the most recent closed ones, oldest first. */
  proposals: Proposal[];
  /** Last proposal number handed out. */
  proposalSeq: number;
}

/** What a proposal would do if it passes. */
export type ProposalChange =
  | { kind: 'params'; values: Partial<Params> }
  | { kind: 'fund'; projectId: ProjectId; asset: AccountAsset; amount: number };

export type Ballot = 'yes' | 'no';
export type Stance = 'for' | 'against';

export interface Speech {
  agentKey: AgentKey;
  stance: Stance;
  text: string;
  tick: Uint256;
  /** Who wrote it: the Chog's AI, its rules-based mind, or its holder by hand. */
  by: 'ai' | 'rules' | 'holder';
}

/** What a Chog's mind decides in one council session. Everything in it is checked before it counts. */
export interface CouncilTurn {
  speeches: Array<{ proposalId: string; stance: Stance; text: string }>;
  proposal: { title: string; change: ProposalChange } | null;
  by: 'ai' | 'rules';
}
export type ProposalStatus = 'open' | 'passed' | 'rejected' | 'failed';

export interface Proposal {
  id: string;
  /** The Chog that put it forward. */
  proposer: AgentKey;
  title: string;
  change: ProposalChange;
  openedTick: Uint256;
  closesTick: Uint256;
  /** One ballot per citizen; the latest counts until the vote closes. */
  votes: Record<CitizenKey, Ballot>;
  /** The council debate: at most one speech per Chog, the latest replacing the earlier one. */
  speeches: Speech[];
  status: ProposalStatus;
  resolvedTick: Uint256 | null;
  /** Why it failed or was rejected, in plain words. */
  outcome: string | null;
}

export type LedgerReason =
  | 'admission'
  | 'gather_input'
  | 'gather_output'
  | 'build_reserve'
  | 'build_consume'
  | 'build_release'
  | 'eat'
  | 'decor'
  | 'gift_out'
  | 'gift_in'
  | 'sold'
  | 'bought'
  | 'hired_output'
  | 'project';

export interface LedgerEntry {
  agentKey: AgentKey;
  resource: Resource;
  totalDelta: number;
  reservedDelta: number;
  /** One stable action/admission/policy change. */
  causeId: string;
  /** resource + reason within the cause. Unique (city, causeId, lineId). */
  lineId: string;
  reason: LedgerReason;
}

/** Coins and the city stores, outside any Chog's inventory. `treasury` or a citizen key. */
export type AccountAsset = 'coins' | Resource;
export type AccountReason =
  | 'grant'
  | 'treasury_grant'
  | 'wage'
  | 'wage_paid'
  | 'tax'
  | 'work_output'
  | 'gift_out'
  | 'gift_in'
  | 'sold'
  | 'bought'
  | 'project';
export interface AccountEntry {
  /** `treasury`, `project:<id>`, a citizen key or a Chog's agent key. */
  account: string;
  asset: AccountAsset;
  delta: number;
  causeId: string;
  /** account + asset + reason within the cause. */
  lineId: string;
  reason: AccountReason;
}

export interface Actor {
  sessionId: string;
  address: Address;
}

export interface TickCommit {
  tick: Uint256;
  revision: Uint256;
  inputHash: string;
  resultHash: string;
  actionCount: number;
}

/** Public, typed description of what changed. */
export type PublicChange =
  | { type: 'moved'; agentKey: AgentKey; to: Location }
  | { type: 'gathered'; agentKey: AgentKey; placeId: PlaceId; resource: Resource; amount: number }
  | { type: 'build_started'; agentKey: AgentKey; targetLevel: number; actionId: string }
  | { type: 'build_progressed'; agentKey: AgentKey; remainingTicks: number }
  | { type: 'build_completed'; agentKey: AgentKey; level: number; homeStyle: HomeStyle }
  | { type: 'build_cancelled'; agentKey: AgentKey; actionId: string; cause: 'policy' | 'control' }
  | { type: 'greeted'; agentKey: AgentKey; otherKey: AgentKey }
  | { type: 'ate'; agentKey: AgentKey }
  | { type: 'decorated'; agentKey: AgentKey; item: DecorId }
  | { type: 'idle'; agentKey: AgentKey; reason: 'paused' | 'unavailable' | 'ruins' | 'nothing_to_do' }
  | { type: 'policy_changed'; agentKey: AgentKey; policy: Policy }
  | { type: 'citizen_joined'; citizenKey: CitizenKey; name: string; lotId: string }
  | { type: 'citizen_moved'; citizenKey: CitizenKey; to: CitizenLocation }
  | { type: 'citizen_worked'; citizenKey: CitizenKey; placeId: PlaceId; resource: Resource; amount: number; wage: number; tax: number }
  | { type: 'job_changed'; citizenKey: CitizenKey; job: Job }
  | { type: 'params_changed'; version: Uint256; values: Params }
  | { type: 'gift'; from: PartyKey; to: PartyKey; asset: AccountAsset; amount: number }
  | { type: 'traded'; agentKey: AgentKey; side: 'sell' | 'buy'; resource: Resource; amount: number; coins: number }
  | { type: 'offer_posted'; agentKey: AgentKey; offer: JobOffer | null }
  | { type: 'hired'; citizenKey: CitizenKey; employer: AgentKey | null }
  | { type: 'contributed'; projectId: ProjectId; from: PartyKey; asset: AccountAsset; amount: number }
  | { type: 'project_completed'; projectId: ProjectId }
  | { type: 'proposal_opened'; proposalId: string; proposer: AgentKey; title: string }
  | { type: 'voted'; proposalId: string; citizenKey: CitizenKey; ballot: Ballot }
  | { type: 'spoke'; proposalId: string; agentKey: AgentKey; stance: Stance; text: string; by: Speech['by'] }
  | { type: 'proposal_closed'; proposalId: string; status: Exclude<ProposalStatus, 'open'>; yes: number; no: number; outcome: string | null }
  | {
      type: 'control_changed';
      agentKey: AgentKey;
      control: CanonicalControlState;
      availability: ControlAvailability;
    };

/** What one resident did in a tick, for Cult (see the City-Cult contract). Visits and greets earn presence. */
export type TickActivityKind = 'visit' | 'greet' | 'gather' | 'build' | 'idle';
export interface TickActivity {
  agentKey: AgentKey;
  kind: TickActivityKind;
  location: Location;
}

export interface TickInput {
  world: WorldState;
}

export interface TickResult {
  world: WorldState;
  ledger: LedgerEntry[];
  /** City money and the city stores (citizens and the treasury). */
  accounts: AccountEntry[];
  changes: PublicChange[];
  /** One entry per resident that acted this tick, in agent-key order. Empty outside ticks. */
  activities: TickActivity[];
  actionCount: number;
  resultHash: string;
}

export interface PolicyUpdateRequest {
  expectedVersion: Uint256;
  expectedEpoch: Uint256;
  active: boolean;
  focus: Focus;
  homeStyle: HomeStyle;
}

export type CityEventType =
  | 'city_tick'
  | 'policy_changed'
  | 'control_changed'
  | 'resident_admitted'
  | 'simulation_gap'
  | 'home_decorated'
  | 'citizen_joined'
  | 'job_changed'
  | 'params_changed'
  | 'city_action'
  | 'council';

export interface CityEvent {
  revision: Uint256;
  type: CityEventType;
  /** `activities` is present on city_tick events only. */
  data: { tick: Uint256; changes: PublicChange[]; activities?: TickActivity[] };
  createdAt: string;
}

export interface CitySnapshot {
  revision: Uint256;
  tick: Uint256;
  nextDueAt: string;
  world: WorldState;
  recentEvents: CityEvent[];
}

export interface DecorateRequest {
  expectedEpoch: Uint256;
  item: DecorId;
}

export type DecorateResult =
  | { ok: true; agent: AgentState }
  | {
      ok: false;
      code: 'CONTROL_CHANGED' | 'NOT_CONTROLLER' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' | 'ALREADY_OWNED' | 'DECOR_FULL' | 'CANT_AFFORD';
    };

/** An agent key (a Chog) or a citizen key (`citizen:0x...`). */
export type PartyKey = string;

/** Who pays: the signed-in citizen, or a Chog the signed-in holder controls (fenced by its epoch). */
export type Party = { kind: 'citizen' } | { kind: 'chog'; key: AgentKey; expectedEpoch: Uint256 };

/** Things players do in the economy. Each is checked and applied by `applyAction`. */
export type CityAction =
  | { type: 'gift'; from: Party; to: PartyKey; asset: AccountAsset; amount: number }
  | { type: 'trade'; chog: AgentKey; expectedEpoch: Uint256; side: 'sell' | 'buy'; resource: Resource; amount: number }
  | { type: 'offer'; chog: AgentKey; expectedEpoch: Uint256; offer: JobOffer | null }
  | { type: 'take_offer'; employer: AgentKey }
  | { type: 'contribute'; projectId: ProjectId; from: Party; asset: AccountAsset; amount: number }
  | { type: 'propose'; chog: AgentKey; expectedEpoch: Uint256; title: string; change: ProposalChange }
  | { type: 'vote'; proposalId: string; ballot: Ballot }
  | { type: 'speak'; chog: AgentKey; expectedEpoch: Uint256; proposalId: string; stance: Stance; text: string };

export type ActionRefusal =
  | 'LOGIN_REQUIRED'
  | 'NOT_A_CITIZEN'
  | 'NOT_CONTROLLER'
  | 'CONTROL_CHANGED'
  | 'NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NOT_ENOUGH'
  | 'NO_ROOM'
  | 'TREASURY_EMPTY'
  | 'MARKET_EMPTY'
  | 'NO_OFFER'
  | 'OFFER_TAKEN'
  | 'NOT_NEEDED'
  | 'NOT_ALLOWED'
  | 'CANT_VOTE_YET'
  | 'VOTE_CLOSED'
  | 'TOO_MANY_PROPOSALS';

export type ActionResult = { ok: true } | { ok: false; code: ActionRefusal };

export interface JoinRequest {
  name: string;
  look: VillagerLook;
}

export type JoinResult =
  | { ok: true; citizen: CitizenState }
  | { ok: false; code: 'LOGIN_REQUIRED' | 'DISTRICT_FULL' | 'IDEMPOTENCY_CONFLICT' };

export interface JobRequest {
  expectedVersion: Uint256;
  job: Job;
}

export type JobResult =
  | { ok: true; citizen: CitizenState }
  | { ok: false; code: 'LOGIN_REQUIRED' | 'NOT_A_CITIZEN' | 'JOB_CHANGED' | 'IDEMPOTENCY_CONFLICT' };

/** A holder's private standing instructions to their Chog (cleared when it changes hands). */
export interface InstructionsRequest {
  expectedEpoch: Uint256;
  text: string;
}

export type InstructionsResult =
  | { ok: true; text: string }
  | { ok: false; code: 'NOT_CONTROLLER' | 'CONTROL_CHANGED' | 'NOT_FOUND' | 'LOGIN_REQUIRED' };

export type PolicyUpdateResult =
  | { ok: true; agent: AgentState }
  | { ok: false; code: 'POLICY_CHANGED' | 'CONTROL_CHANGED' | 'NOT_CONTROLLER' | 'NOT_FOUND' | 'IDEMPOTENCY_CONFLICT' };

/** Web port shared by the fixture client and (Task 8) the HTTP client. */
export interface CityClient {
  getSnapshot(): Promise<CitySnapshot>;
  getAgent(key: AgentKey): Promise<AgentState | null>;
  getMyAgents(): Promise<AgentState[]>;
  updatePolicy(key: AgentKey, request: PolicyUpdateRequest, idempotencyKey: string): Promise<PolicyUpdateResult>;
  /** Buys a decoration for the Chog's home with its own stores. Holder only. */
  decorate(key: AgentKey, request: DecorateRequest, idempotencyKey: string): Promise<DecorateResult>;
  subscribe(afterRevision: Uint256, onEvent: (event: CityEvent) => void, onReset: () => void): () => void;
  /** The signed-in player's villager, or null (not signed in, or not joined yet). */
  getMyCitizen(): Promise<CitizenState | null>;
  /** Anyone signed in can join, NFT or not. Joining again returns the same villager. */
  joinCity(request: JoinRequest, idempotencyKey: string): Promise<JoinResult>;
  setJob(request: JobRequest, idempotencyKey: string): Promise<JobResult>;
  /** Gifts, market trades, job offers and project contributions. */
  act(action: CityAction, idempotencyKey: string): Promise<ActionResult>;
  /** The holder's standing instructions for their Chog; null for anyone else or when none are set. */
  getInstructions(key: AgentKey): Promise<string | null>;
  setInstructions(key: AgentKey, request: InstructionsRequest): Promise<InstructionsResult>;
}
