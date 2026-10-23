// The economy: gifts, the Plaza market, Chogs hiring citizens, and shared projects. Pure functions; every coin
// and material moves through a ledger line (a Chog's materials) or an AccountEntry (coins, the treasury's
// stores, project funds), so the books always balance.
import {
  PROJECT_IDS,
  RESOURCES,
  type AccountAsset,
  type AccountEntry,
  type AccountReason,
  type ActionRefusal,
  type Address,
  type AgentState,
  type CitizenState,
  type CityAction,
  type CouncilTurn,
  type ProposalChange,
  type Speech,
  type Stance,
  type LedgerEntry,
  type LedgerReason,
  type Party,
  type ProjectId,
  type ProjectState,
  type PublicChange,
  type Resource,
  type WorldState,
} from '../shared/contracts';
import { checkParamChange } from '../shared/constitution';
import {
  JOB_SITE,
  MARKET_BASE,
  MAX_OPEN_PER_CHOG,
  MAX_OPEN_PROPOSALS,
  MAX_SPEECH,
  MARKET_PIVOT,
  MAX_TRADE,
  OFFER_WAGE_MAX,
  OFFER_WAGE_MIN,
  PROJECTS,
  RESOURCE_CAP,
  TREASURY_CAP,
} from '../shared/rules';
import { accountEntry, canVote, citizenKeyOf } from './citizens';
import { isOpen, openProposal } from './governance';
import { applyLedger, available, line } from './resources';

/** Most coins in one gift or contribution. */
export const MAX_COIN_GIFT = 500;

export const isCitizenKey = (key: string): boolean => key.startsWith('citizen:');
export const projectAccount = (id: ProjectId): string => `project:${id}`;

export function emptyProjects(): Record<ProjectId, ProjectState> {
  return Object.fromEntries(
    PROJECT_IDS.map((id) => [id, { given: { wood: 0, stone: 0, food: 0, coins: 0 }, completedTick: null }]),
  ) as Record<ProjectId, ProjectState>;
}

export const projectDone = (world: WorldState, id: ProjectId): boolean => world.projects[id].completedTick !== null;

/** The market's cut, in percent; the Market Hall halves it. */
export function marketFee(world: WorldState): number {
  const fee = world.params.values.marketFeePct;
  return projectDone(world, 'market_hall') ? Math.floor(fee / 2) : fee;
}

/**
 * Prices per unit at the Plaza right now. `mid` doubles when the treasury holds none of a resource and is the
 * base price at MARKET_PIVOT units; a buyer pays mid plus the fee, a seller gets mid less the fee.
 */
export function marketPrices(world: WorldState, resource: Resource): { mid: number; buy: number; sell: number } {
  const stock = world.treasury.stores[resource];
  const mid = Math.max(1, Math.round((MARKET_BASE[resource] * 2 * MARKET_PIVOT) / (stock + MARKET_PIVOT)));
  const fee = marketFee(world);
  return { mid, buy: Math.ceil((mid * (100 + fee)) / 100), sell: Math.floor((mid * (100 - fee)) / 100) };
}

export type Applied = { ok: true; world: WorldState; ledger: LedgerEntry[]; accounts: AccountEntry[]; changes: PublicChange[] };
type Refused = { ok: false; code: ActionRefusal };
const refuse = (code: ActionRefusal): Refused => ({ ok: false, code });

/** A mutable working copy of the parts of the world an action touches. */
class Draft {
  agents: AgentState[];
  citizens: CitizenState[];
  treasury: WorldState['treasury'];
  projects: WorldState['projects'];
  proposals: WorldState['proposals'];
  proposalSeq: number;
  ledger: LedgerEntry[] = [];
  accounts: AccountEntry[] = [];
  changes: PublicChange[] = [];

  constructor(
    readonly world: WorldState,
    readonly causeId: string,
  ) {
    this.agents = world.agents.slice();
    this.citizens = world.citizens.slice();
    this.treasury = { coins: world.treasury.coins, stores: { ...world.treasury.stores } };
    this.projects = { ...world.projects };
    this.proposals = world.proposals.slice();
    this.proposalSeq = world.proposalSeq;
  }

  agent(key: string): AgentState | undefined {
    return this.agents.find((a) => a.key === key);
  }

  citizen(key: string): CitizenState | undefined {
    return this.citizens.find((c) => c.key === key);
  }

  setAgent(next: AgentState): void {
    this.agents = this.agents.map((a) => (a.key === next.key ? next : a));
  }

  setCitizen(next: CitizenState): void {
    this.citizens = this.citizens.map((c) => (c.key === next.key ? next : c));
  }

  coinsOf(key: string): number {
    return (isCitizenKey(key) ? this.citizen(key)?.coins : this.agent(key)?.coins) ?? 0;
  }

  /** Moves coins on the books and in the stored balance (citizen, Chog, treasury or project). */
  coins(account: string, reason: AccountReason, delta: number): void {
    if (delta === 0) return;
    this.accounts.push(accountEntry(account, this.causeId, 'coins', reason, delta));
    if (account === 'treasury') this.treasury = { ...this.treasury, coins: this.treasury.coins + delta };
    else if (isCitizenKey(account)) {
      const c = this.citizen(account)!;
      this.setCitizen({ ...c, coins: c.coins + delta });
    } else if (!account.startsWith('project:')) {
      const a = this.agent(account)!;
      this.setAgent({ ...a, coins: a.coins + delta });
    }
  }

  /** Moves a Chog's materials through its ledger. */
  materials(agentKey: string, resource: Resource, reason: LedgerReason, delta: number): void {
    const entry = line(agentKey, this.causeId, resource, reason, delta, 0);
    this.ledger.push(entry);
    const a = this.agent(agentKey)!;
    this.setAgent({ ...a, inventory: applyLedger(a.inventory, [entry]) });
  }

  /** Moves the treasury's stores (or a project's materials) on the books. */
  stores(account: string, resource: Resource, reason: AccountReason, delta: number): void {
    this.accounts.push(accountEntry(account, this.causeId, resource, reason, delta));
    if (account === 'treasury') this.treasury = { ...this.treasury, stores: { ...this.treasury.stores, [resource]: this.treasury.stores[resource] + delta } };
  }

  done(): Applied {
    return {
      ok: true,
      world: {
        ...this.world,
        agents: this.agents,
        citizens: this.citizens,
        treasury: this.treasury,
        projects: this.projects,
        proposals: this.proposals,
        proposalSeq: this.proposalSeq,
      },
      ledger: this.ledger,
      accounts: this.accounts,
      changes: this.changes,
    };
  }
}

/** The paying side: the actor's own villager, or a Chog the actor controls at the expected epoch. */
function resolve(draft: Draft, actor: Address, party: Party): { ok: true; key: string } | Refused {
  if (party.kind === 'citizen') {
    const key = citizenKeyOf(actor);
    return draft.citizen(key) ? { ok: true, key } : refuse('NOT_A_CITIZEN');
  }
  return controlled(draft, actor, party.key, party.expectedEpoch);
}

function controlled(draft: Draft, actor: Address, key: string, expectedEpoch: string): { ok: true; key: string } | Refused {
  const agent = draft.agent(key);
  if (!agent) return refuse('NOT_FOUND');
  if (agent.control.kind !== 'controlled' || agent.controlAvailability !== 'verified' || agent.control.controller?.toLowerCase() !== actor.toLowerCase()) {
    return refuse('NOT_CONTROLLER');
  }
  if (agent.control.epoch !== expectedEpoch) return refuse('CONTROL_CHANGED');
  return { ok: true, key };
}

const isResource = (asset: AccountAsset): asset is Resource => (RESOURCES as readonly string[]).includes(asset);
const validAmount = (asset: AccountAsset, amount: number) =>
  Number.isInteger(amount) && amount >= 1 && amount <= (asset === 'coins' ? MAX_COIN_GIFT : MAX_TRADE);

/** Checks and applies one player action. `causeId` must be unique per action (the request's idempotency scope). */
export function applyAction(world: WorldState, actor: Address, action: CityAction, causeId: string): Applied | Refused {
  const draft = new Draft(world, causeId);
  switch (action.type) {
    case 'gift':
      return gift(draft, actor, action);
    case 'trade':
      return trade(draft, actor, action);
    case 'offer':
      return offer(draft, actor, action);
    case 'take_offer':
      return takeOffer(draft, actor, action);
    case 'contribute':
      return contribute(draft, actor, action);
    case 'propose':
      return propose(draft, actor, action);
    case 'vote':
      return vote(draft, actor, action);
    case 'speak':
      return speak(draft, actor, action);
  }
}

function propose(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'propose' }>): Applied | Refused {
  const who = controlled(draft, actor, action.chog, action.expectedEpoch);
  if (!who.ok) return who;
  const opened = proposeFor(draft, who.key, action.title, action.change);
  return opened === true ? draft.done() : opened;
}

/** Opens a proposal for a Chog, under the same checks whoever asks (its holder or its own mind). */
function proposeFor(draft: Draft, chogKey: string, title: string, change: ProposalChange): true | Refused {
  const open = draft.proposals.filter(isOpen);
  if (open.length >= MAX_OPEN_PROPOSALS || open.filter((p) => p.proposer === chogKey).length >= MAX_OPEN_PER_CHOG) return refuse('TOO_MANY_PROPOSALS');
  const cleanTitle = title.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (cleanTitle.length < 3) return refuse('NOT_ALLOWED');
  if (change.kind === 'params') {
    if (!checkParamChange(draft.world.params.values, change.values as Record<string, number>).ok) return refuse('NOT_ALLOWED');
  } else {
    const project = draft.projects[change.projectId];
    if (!project || !validAmount(change.asset, change.amount)) return refuse('NOT_ALLOWED');
    if (project.completedTick !== null || PROJECTS[change.projectId].needs[change.asset] <= project.given[change.asset]) return refuse('NOT_NEEDED');
  }
  const proposal = openProposal({ ...draft.world, proposalSeq: draft.proposalSeq }, chogKey, cleanTitle, change);
  draft.proposals = [...draft.proposals, proposal];
  draft.proposalSeq += 1;
  draft.changes.push({ type: 'proposal_opened', proposalId: proposal.id, proposer: chogKey, title: proposal.title });
  return true;
}

/** One speech per Chog per open proposal; a new one replaces its earlier speech. */
function speakFor(draft: Draft, chogKey: string, proposalId: string, stance: Stance, text: string, by: Speech['by']): true | Refused {
  const proposal = draft.proposals.find((p) => p.id === proposalId);
  if (!proposal) return refuse('NOT_FOUND');
  if (!isOpen(proposal) || BigInt(draft.world.tick) >= BigInt(proposal.closesTick)) return refuse('VOTE_CLOSED');
  if (stance !== 'for' && stance !== 'against') return refuse('NOT_ALLOWED');
  const clean = cleanSpeech(text);
  if (!clean) return refuse('NOT_ALLOWED');
  const speech: Speech = { agentKey: chogKey, stance, text: clean, tick: draft.world.tick, by };
  draft.proposals = draft.proposals.map((p) => (p.id === proposalId ? { ...p, speeches: [...p.speeches.filter((s) => s.agentKey !== chogKey), speech] } : p));
  draft.changes.push({ type: 'spoke', proposalId, agentKey: chogKey, stance, text: clean, by });
  return true;
}

/** One line of plain text, at most MAX_SPEECH characters; null when nothing is left. */
export function cleanSpeech(text: string): string | null {
  const flat = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_SPEECH ? `${flat.slice(0, MAX_SPEECH - 1).trimEnd()}…` : flat;
}

function speak(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'speak' }>): Applied | Refused {
  const who = controlled(draft, actor, action.chog, action.expectedEpoch);
  if (!who.ok) return who;
  const spoken = speakFor(draft, who.key, action.proposalId, action.stance, action.text, 'holder');
  return spoken === true ? draft.done() : spoken;
}

/**
 * A Chog's council session, from its AI or its rules-based mind. The Chog must be held, verified and active.
 * Each part is checked like a holder's own action; parts that fail are dropped, the rest still count.
 */
export function applyCouncilTurn(world: WorldState, chogKey: string, turn: CouncilTurn, causeId: string): Applied & { dropped: number } {
  const draft = new Draft(world, causeId);
  const chog = draft.agent(chogKey);
  if (!chog || chog.control.kind !== 'controlled' || chog.controlAvailability !== 'verified' || !chog.policy.active) {
    return { ...draft.done(), dropped: turn.speeches.length + (turn.proposal ? 1 : 0) };
  }
  let dropped = 0;
  const seen = new Set<string>();
  for (const s of turn.speeches) {
    if (seen.has(s.proposalId)) { dropped += 1; continue; }
    seen.add(s.proposalId);
    if (speakFor(draft, chogKey, s.proposalId, s.stance, s.text, turn.by) !== true) dropped += 1;
  }
  if (turn.proposal && proposeFor(draft, chogKey, turn.proposal.title, turn.proposal.change) !== true) dropped += 1;
  return { ...draft.done(), dropped };
}

function vote(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'vote' }>): Applied | Refused {
  const key = citizenKeyOf(actor);
  const citizen = draft.citizen(key);
  if (!citizen) return refuse('NOT_A_CITIZEN');
  if (!canVote(citizen)) return refuse('CANT_VOTE_YET');
  const proposal = draft.proposals.find((p) => p.id === action.proposalId);
  if (!proposal) return refuse('NOT_FOUND');
  if (!isOpen(proposal) || BigInt(draft.world.tick) >= BigInt(proposal.closesTick)) return refuse('VOTE_CLOSED');
  if (proposal.votes[key] === action.ballot) return draft.done();
  draft.proposals = draft.proposals.map((p) => (p.id === proposal.id ? { ...p, votes: { ...p.votes, [key]: action.ballot } } : p));
  draft.changes.push({ type: 'voted', proposalId: proposal.id, citizenKey: key, ballot: action.ballot });
  return draft.done();
}

function gift(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'gift' }>): Applied | Refused {
  if (!validAmount(action.asset, action.amount)) return refuse('NOT_ALLOWED');
  const from = resolve(draft, actor, action.from);
  if (!from.ok) return from;
  if (from.key === action.to) return refuse('NOT_ALLOWED');
  const toCitizen = isCitizenKey(action.to);
  const recipient = toCitizen ? draft.citizen(action.to) : draft.agent(action.to);
  if (!recipient) return refuse('NOT_FOUND');
  if (!toCitizen && (recipient as AgentState).control.kind !== 'controlled') return refuse('NOT_ALLOWED');
  if (action.asset === 'coins') {
    if (draft.coinsOf(from.key) < action.amount) return refuse('NOT_ENOUGH');
    draft.coins(from.key, 'gift_out', -action.amount);
    draft.coins(action.to, 'gift_in', action.amount);
  } else {
    // Materials live in Chogs' stores only.
    if (isCitizenKey(from.key) || toCitizen) return refuse('NOT_ALLOWED');
    const giver = draft.agent(from.key)!;
    const taker = recipient as AgentState;
    if (available(giver.inventory, action.asset) < action.amount) return refuse('NOT_ENOUGH');
    if (taker.inventory[action.asset].total + action.amount > RESOURCE_CAP) return refuse('NO_ROOM');
    draft.materials(from.key, action.asset, 'gift_out', -action.amount);
    draft.materials(action.to, action.asset, 'gift_in', action.amount);
  }
  draft.changes.push({ type: 'gift', from: from.key, to: action.to, asset: action.asset, amount: action.amount });
  return draft.done();
}

function trade(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'trade' }>): Applied | Refused {
  if (!validAmount(action.resource, action.amount)) return refuse('NOT_ALLOWED');
  const who = controlled(draft, actor, action.chog, action.expectedEpoch);
  if (!who.ok) return who;
  const chog = draft.agent(who.key)!;
  const prices = marketPrices(draft.world, action.resource);
  const r = action.resource;
  if (action.side === 'sell') {
    const coins = prices.sell * action.amount;
    if (coins <= 0) return refuse('NOT_ALLOWED');
    if (available(chog.inventory, r) < action.amount) return refuse('NOT_ENOUGH');
    if (draft.treasury.stores[r] + action.amount > TREASURY_CAP) return refuse('NO_ROOM');
    if (draft.treasury.coins < coins) return refuse('TREASURY_EMPTY');
    draft.materials(who.key, r, 'sold', -action.amount);
    draft.stores('treasury', r, 'bought', action.amount);
    draft.coins('treasury', 'bought', -coins);
    draft.coins(who.key, 'sold', coins);
    draft.changes.push({ type: 'traded', agentKey: who.key, side: 'sell', resource: r, amount: action.amount, coins });
  } else {
    const coins = prices.buy * action.amount;
    if (draft.treasury.stores[r] < action.amount) return refuse('MARKET_EMPTY');
    if (chog.inventory[r].total + action.amount > RESOURCE_CAP) return refuse('NO_ROOM');
    if (chog.coins < coins) return refuse('NOT_ENOUGH');
    draft.materials(who.key, r, 'bought', action.amount);
    draft.stores('treasury', r, 'sold', -action.amount);
    draft.coins(who.key, 'bought', -coins);
    draft.coins('treasury', 'sold', coins);
    draft.changes.push({ type: 'traded', agentKey: who.key, side: 'buy', resource: r, amount: action.amount, coins });
  }
  return draft.done();
}

function offer(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'offer' }>): Applied | Refused {
  const who = controlled(draft, actor, action.chog, action.expectedEpoch);
  if (!who.ok) return who;
  const next = action.offer;
  if (next && (!(next.job in JOB_SITE) || !Number.isInteger(next.wage) || next.wage < OFFER_WAGE_MIN || next.wage > OFFER_WAGE_MAX)) {
    return refuse('NOT_ALLOWED');
  }
  const chog = draft.agent(who.key)!;
  draft.setAgent({ ...chog, offer: next ? { job: next.job, wage: next.wage } : null });
  draft.changes.push({ type: 'offer_posted', agentKey: who.key, offer: next });
  // Whoever works for this Chog follows the new offer, or goes back to working for the city.
  const employee = draft.citizens.find((c) => c.employer === who.key);
  if (employee) {
    const bump = (BigInt(employee.jobVersion) + 1n).toString();
    if (!next) {
      draft.setCitizen({ ...employee, employer: null, jobVersion: bump });
      draft.changes.push({ type: 'hired', citizenKey: employee.key, employer: null });
    } else if (employee.job !== next.job) draft.setCitizen({ ...employee, job: next.job, jobVersion: bump });
  }
  return draft.done();
}

function takeOffer(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'take_offer' }>): Applied | Refused {
  const key = citizenKeyOf(actor);
  const citizen = draft.citizen(key);
  if (!citizen) return refuse('NOT_A_CITIZEN');
  const employer = draft.agent(action.employer);
  if (!employer?.offer || employer.control.kind !== 'controlled') return refuse('NO_OFFER');
  if (draft.citizens.some((c) => c.employer === employer.key && c.key !== key)) return refuse('OFFER_TAKEN');
  if (citizen.employer === employer.key && citizen.job === employer.offer.job) return draft.done();
  draft.setCitizen({ ...citizen, employer: employer.key, job: employer.offer.job, jobVersion: (BigInt(citizen.jobVersion) + 1n).toString() });
  draft.changes.push({ type: 'hired', citizenKey: key, employer: employer.key });
  return draft.done();
}

function contribute(draft: Draft, actor: Address, action: Extract<CityAction, { type: 'contribute' }>): Applied | Refused {
  if (!validAmount(action.asset, action.amount)) return refuse('NOT_ALLOWED');
  const project = draft.projects[action.projectId];
  if (!project) return refuse('NOT_FOUND');
  const from = resolve(draft, actor, action.from);
  if (!from.ok) return from;
  const need = PROJECTS[action.projectId].needs[action.asset] - project.given[action.asset];
  if (project.completedTick !== null || need <= 0) return refuse('NOT_NEEDED');
  const amount = Math.min(action.amount, need);
  const account = projectAccount(action.projectId);
  if (action.asset === 'coins') {
    if (draft.coinsOf(from.key) < amount) return refuse('NOT_ENOUGH');
    draft.coins(from.key, 'project', -amount);
    draft.coins(account, 'project', amount);
  } else {
    if (isCitizenKey(from.key)) return refuse('NOT_ALLOWED');
    if (!isResource(action.asset) || available(draft.agent(from.key)!.inventory, action.asset) < amount) return refuse('NOT_ENOUGH');
    draft.materials(from.key, action.asset, 'project', -amount);
    draft.stores(account, action.asset, 'project', amount);
  }
  const given = { ...project.given, [action.asset]: project.given[action.asset] + amount };
  const needs = PROJECTS[action.projectId].needs;
  const complete = (['wood', 'stone', 'food', 'coins'] as const).every((a) => given[a] >= needs[a]);
  draft.projects = { ...draft.projects, [action.projectId]: { given, completedTick: complete ? draft.world.tick : null } };
  draft.changes.push({ type: 'contributed', projectId: action.projectId, from: from.key, asset: action.asset, amount });
  if (complete) draft.changes.push({ type: 'project_completed', projectId: action.projectId });
  return draft.done();
}
