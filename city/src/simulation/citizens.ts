// Citizens: players with a Chog-like villager, with or without an NFT. Pure functions; no clocks or randomness.
// Their work fills the treasury's stores and earns a wage in new coins, taxed for the treasury. Every coin and
// every stored resource moves through an AccountEntry, so the city's books always balance.
import type {
  AccountAsset,
  AccountEntry,
  AccountReason,
  Address,
  AgentKey,
  AgentState,
  LedgerEntry,
  CitizenKey,
  CitizenLocation,
  CitizenState,
  Job,
  Params,
  PublicChange,
  Treasury,
  VillagerLook,
  WorldState,
} from '../shared/contracts';
import { checkParamChange } from '../shared/constitution';
import {
  CITIZEN_BEDTIME_TICK,
  CITIZEN_GRANT,
  DAY_START_TICK,
  DAY_TICKS,
  GATHER_SITES,
  JOB_SITE,
  PROJECTS,
  RESOURCE_CAP,
  TREASURY_CAP,
  VILLAGER_OPTIONS,
  VOTE_ACTIVE_DAYS,
  WAKE_TICK,
  siteYield,
} from '../shared/rules';
import { hourOf } from './policies';
import { applyLedger, line } from './resources';

export const citizenKeyOf = (address: Address): CitizenKey => `citizen:${address.toLowerCase()}`;

export function accountEntry(account: string, causeId: string, asset: AccountAsset, reason: AccountReason, delta: number): AccountEntry {
  return { account, asset, delta, causeId, lineId: `${account}:${asset}:${reason}`, reason };
}

/** Village day number of a tick (day 0 is the first). */
export const dayOf = (tick: string): number => Number((BigInt(tick) + BigInt(DAY_START_TICK)) / BigInt(DAY_TICKS));

/** Night at home: bedtimes staggered by address so the district doesn't move in lockstep. */
export function citizenAsleep(citizen: Pick<CitizenState, 'address'>, tick: string): boolean {
  const hour = hourOf(tick);
  const bedtime = CITIZEN_BEDTIME_TICK + (parseInt(citizen.address.slice(-2), 16) % 3);
  return hour >= bedtime && hour < WAKE_TICK;
}

export const canVote = (citizen: Pick<CitizenState, 'activeDays'>): boolean => citizen.activeDays >= VOTE_ACTIVE_DAYS;

/** A default villager look picked from the address, so every newcomer looks a little different. */
export function villagerLookFor(address: Address): VillagerLook {
  const hex = address.toLowerCase().replace(/^0x/, '');
  const pick = (options: readonly string[], at: number) => options[parseInt(hex.slice(at, at + 4), 16) % options.length]!;
  return { Skin: pick(VILLAGER_OPTIONS.Skin, 0), Head: pick(VILLAGER_OPTIONS.Head, 4), Body: pick(VILLAGER_OPTIONS.Body, 8), Eyes: pick(VILLAGER_OPTIONS.Eyes, 12) };
}

const sameLocation = (a: CitizenLocation, b: CitizenLocation) =>
  a.kind === b.kind && (a.kind === 'place' ? a.placeId === (b as typeof a).placeId : a.lotId === (b as typeof a).lotId);

const byKey = (a: CitizenState, b: CitizenState) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export interface CitizensTick {
  citizens: CitizenState[];
  /** Employers' stores and coins after paying their hired citizens. */
  agents: AgentState[];
  treasury: Treasury;
  ledger: LedgerEntry[];
  accounts: AccountEntry[];
  changes: PublicChange[];
}

/** An employer that can still hire: held, verified, with a standing offer for this job. */
function employerFor(citizen: CitizenState, agents: ReadonlyMap<AgentKey, AgentState>): AgentState | null {
  if (!citizen.employer) return null;
  const employer = agents.get(citizen.employer);
  if (!employer || employer.control.kind !== 'controlled' || employer.controlAvailability !== 'verified') return null;
  return employer.offer && employer.offer.job === citizen.job ? employer : null;
}

/**
 * One tick of the district: everyone goes to work or home, and work pays. Order: citizen key. A hired citizen
 * works for its Chog (output to the Chog's stores, wage from the Chog's coins); everyone else works for the city.
 * `agents` are the Chogs after their own turn this tick.
 */
export function stepCitizens(world: WorldState, tick: string, agents: readonly AgentState[] = world.agents): CitizensTick {
  const { values } = world.params;
  let treasury: Treasury = { coins: world.treasury.coins, stores: { ...world.treasury.stores } };
  const byAgent = new Map(agents.map((a) => [a.key, a]));
  const ledger: LedgerEntry[] = [];
  const accounts: AccountEntry[] = [];
  const changes: PublicChange[] = [];
  const next = new Map<CitizenKey, CitizenState>();

  for (let citizen of [...world.citizens].sort(byKey)) {
    const employer = employerFor(citizen, byAgent);
    if (citizen.employer && !employer) {
      // The offer was withdrawn or the Chog changed hands: back to working for the city.
      citizen = { ...citizen, employer: null };
      changes.push({ type: 'hired', citizenKey: citizen.key, employer: null });
    }
    const working = citizen.job !== 'off' && !citizenAsleep(citizen, tick);
    const site = working ? JOB_SITE[citizen.job as Exclude<Job, 'off'>] : null;
    const to: CitizenLocation = site ? { kind: 'place', placeId: site } : { kind: 'lot', lotId: citizen.lotId };
    let updated: CitizenState = citizen;
    if (!sameLocation(citizen.location, to)) {
      updated = { ...updated, location: to };
      changes.push({ type: 'citizen_moved', citizenKey: citizen.key, to });
    }
    if (site && employer) {
      const resource = GATHER_SITES[site]!.output;
      const amount = Math.min(siteYield(site, values), RESOURCE_CAP - employer.inventory[resource].total);
      const wage = employer.offer!.wage;
      // A Chog that can't pay, or has no room, gets no work done this tick.
      if (amount > 0 && employer.coins >= wage) {
        const causeId = `work:${tick}:${citizen.key}`;
        const tax = Math.floor((wage * values.incomeTaxPct) / 100);
        const output = line(employer.key, causeId, resource, 'hired_output', amount, 0);
        ledger.push(output);
        accounts.push(accountEntry(employer.key, causeId, 'coins', 'wage_paid', -wage), accountEntry(citizen.key, causeId, 'coins', 'wage', wage));
        if (tax > 0) accounts.push(accountEntry(citizen.key, causeId, 'coins', 'tax', -tax), accountEntry('treasury', causeId, 'coins', 'tax', tax));
        byAgent.set(employer.key, { ...employer, coins: employer.coins - wage, inventory: applyLedger(employer.inventory, [output]) });
        treasury = { ...treasury, coins: treasury.coins + tax };
        updated = { ...updated, coins: updated.coins + wage - tax };
        changes.push({ type: 'citizen_worked', citizenKey: citizen.key, placeId: site, resource, amount, wage, tax });
      }
    } else if (site) {
      const resource = GATHER_SITES[site]!.output;
      const amount = Math.min(siteYield(site, values), TREASURY_CAP - treasury.stores[resource]);
      // Full stores: the citizen turns up, but there is no work to pay for.
      if (amount > 0) {
        const causeId = `work:${tick}:${citizen.key}`;
        const wage = values.wage;
        const tax = Math.floor((wage * values.incomeTaxPct) / 100);
        accounts.push(accountEntry('treasury', causeId, resource, 'work_output', amount));
        if (wage > 0) accounts.push(accountEntry(citizen.key, causeId, 'coins', 'wage', wage));
        if (tax > 0) accounts.push(accountEntry(citizen.key, causeId, 'coins', 'tax', -tax), accountEntry('treasury', causeId, 'coins', 'tax', tax));
        treasury = { coins: treasury.coins + tax, stores: { ...treasury.stores, [resource]: treasury.stores[resource] + amount } };
        updated = { ...updated, coins: updated.coins + wage - tax };
        changes.push({ type: 'citizen_worked', citizenKey: citizen.key, placeId: site, resource, amount, wage, tax });
      }
    }
    // Showing up for work counts towards voting, even on a day the stores are full and nothing is paid.
    if (site) {
      const day = dayOf(tick);
      if (updated.lastWorkedDay !== day) updated = { ...updated, activeDays: updated.activeDays + 1, lastWorkedDay: day };
    }
    next.set(citizen.key, updated);
  }
  return { citizens: world.citizens.map((c) => next.get(c.key)!), agents: agents.map((a) => byAgent.get(a.key)!), treasury, ledger, accounts, changes };
}

export interface CityChange {
  world: WorldState;
  accounts: AccountEntry[];
  changes: PublicChange[];
}

/**
 * A new citizen moves into the first free lot with the starting grant. Joining again returns the same villager
 * unchanged (one villager and one grant per address, ever).
 */
export function admitCitizen(
  world: WorldState,
  input: { address: Address; name: string; look: VillagerLook },
): ({ ok: true; citizen: CitizenState } & CityChange) | { ok: false; code: 'DISTRICT_FULL' } {
  const key = citizenKeyOf(input.address);
  const existing = world.citizens.find((c) => c.key === key);
  if (existing) return { ok: true, citizen: existing, world, accounts: [], changes: [] };
  const taken = new Set(world.citizens.map((c) => c.lotId));
  const lot = world.lots.find((l) => !taken.has(l.id));
  if (!lot) return { ok: false, code: 'DISTRICT_FULL' };
  const citizen: CitizenState = {
    key,
    address: input.address.toLowerCase(),
    name: input.name.trim(),
    look: input.look,
    lotId: lot.id,
    location: { kind: 'lot', lotId: lot.id },
    job: 'off',
    jobVersion: '1',
    coins: CITIZEN_GRANT,
    joinedTick: world.tick,
    activeDays: 0,
    lastWorkedDay: null,
    employer: null,
  };
  return {
    ok: true,
    citizen,
    world: { ...world, citizens: [...world.citizens, citizen] },
    accounts: [accountEntry(key, `join:${key}`, 'coins', 'grant', CITIZEN_GRANT)],
    changes: [{ type: 'citizen_joined', citizenKey: key, name: citizen.name, lotId: lot.id }],
  };
}

/** A citizen's job for the coming ticks, working for the city (this also leaves any Chog employer). */
export function applyJobChange(world: WorldState, key: CitizenKey, job: Job): CityChange {
  const index = world.citizens.findIndex((c) => c.key === key);
  if (index < 0) throw new Error(`unknown citizen ${key}`);
  const citizen = world.citizens[index]!;
  if (citizen.job === job && !citizen.employer) return { world, accounts: [], changes: [] };
  const citizens = world.citizens.slice();
  citizens[index] = { ...citizen, job, employer: null, jobVersion: (BigInt(citizen.jobVersion) + 1n).toString() };
  const changes: PublicChange[] = [{ type: 'job_changed', citizenKey: key, job }];
  if (citizen.employer) changes.unshift({ type: 'hired', citizenKey: key, employer: null });
  return { world: { ...world, citizens }, accounts: [], changes };
}

/** Enacts a parameter change the constitution allows (votes and offices come later). */
export function applyParamChange(
  world: WorldState,
  proposal: Readonly<Record<string, number>>,
): ({ ok: true } & CityChange) | { ok: false; problems: string[] } {
  const checked = checkParamChange(world.params.values, proposal);
  if (!checked.ok) return checked;
  const params = { version: (BigInt(world.params.version) + 1n).toString(), values: checked.values };
  return { ok: true, world: { ...world, params }, accounts: [], changes: [{ type: 'params_changed', version: params.version, values: params.values }] };
}

/** Sum of entries per account and asset, for reconciliation. */
export function accountTotals(entries: readonly AccountEntry[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(`${e.account}|${e.asset}`, (totals.get(`${e.account}|${e.asset}`) ?? 0) + e.delta);
  return totals;
}

/** Problems where stored balances differ from the books (empty when consistent). */
export function reconcileAccounts(world: WorldState, entries: readonly AccountEntry[]): string[] {
  const totals = accountTotals(entries);
  const problems: string[] = [];
  for (const c of world.citizens) {
    const booked = totals.get(`${c.key}|coins`) ?? 0;
    if (booked !== c.coins) problems.push(`${c.name}: books ${booked} coins, stored ${c.coins}`);
  }
  for (const a of world.agents) {
    const booked = totals.get(`${a.key}|coins`) ?? 0;
    if (booked !== a.coins) problems.push(`${a.name}: books ${booked} coins, stored ${a.coins}`);
  }
  const assets: Array<[AccountAsset, number]> = [['coins', world.treasury.coins], ...(['wood', 'stone', 'food'] as const).map((r) => [r, world.treasury.stores[r]] as [AccountAsset, number])];
  for (const [asset, stored] of assets) {
    const booked = totals.get(`treasury|${asset}`) ?? 0;
    if (booked !== stored) problems.push(`treasury ${asset}: books ${booked}, stored ${stored}`);
  }
  for (const [id, project] of Object.entries(world.projects)) {
    for (const asset of ['coins', 'wood', 'stone', 'food'] as const) {
      const booked = totals.get(`project:${id}|${asset}`) ?? 0;
      if (booked !== project.given[asset]) problems.push(`${PROJECTS[id as keyof typeof PROJECTS].name} ${asset}: books ${booked}, given ${project.given[asset]}`);
    }
  }
  return problems;
}

export type { Params };
