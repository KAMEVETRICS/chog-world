// Seeded fixture residents. Local dev/test only: fixed seed, fixed controllers, no RPC.
import worldData from './world.json';
import {
  makeAgentKey,
  type AccountEntry,
  type AgentIdentity,
  type CitizenState,
  type Job,
  type Lot,
  type VillagerLook,
  type AgentState,
  type Focus,
  type HomeStyle,
  type Place,
  type Plot,
  type WorldState,
} from '../shared/contracts';
import { ADMISSION_GRANT, CITIZEN_GRANT, GENESIS_TREASURY_COINS, NEED_START, RULESET_VERSION, VOTE_ACTIVE_DAYS } from '../shared/rules';
import { emptyProjects } from '../simulation/economy';
import { defaultParams } from '../shared/constitution';
import { accountEntry, citizenKeyOf } from '../simulation/citizens';

export const FIXTURE_CHAIN_ID = '10143';
export const FIXTURE_REGISTRY = '0x000000000000000000000000000000000000c170';
export const FIXTURE_ADAPTER = '0x000000000000000000000000000000000000c171';
export const FIXTURE_COLLECTION = '0x000000000000000000000000000000000000c172';

/** The two fixture holders (residents alternate A, B, A, B...) and a player with no Chog NFT. */
export const FIXTURE_ACTORS = {
  A: { label: 'Holder A', address: '0xa11ce00000000000000000000000000000000a11' },
  B: { label: 'Holder B', address: '0xb0b0000000000000000000000000000000000b0b' },
  C: { label: 'Villager C', address: '0xc1c1000000000000000000000000000000000c1c' },
} as const;
export type FixtureActorId = keyof typeof FIXTURE_ACTORS;

interface Seed {
  name: string;
  focus: Focus;
  homeStyle: HomeStyle;
}

const SEEDS: readonly Seed[] = [
  { name: 'Mossy', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Pebble', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Bramble', focus: 'builder', homeStyle: 'treehouse' },
  { name: 'Juniper', focus: 'gatherer', homeStyle: 'cottage' },
  { name: 'Tinder', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Clove', focus: 'social', homeStyle: 'treehouse' },
  { name: 'Fennel', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Sorrel', focus: 'social', homeStyle: 'workshop' },
  { name: 'Wicket', focus: 'gatherer', homeStyle: 'treehouse' },
  { name: 'Thimble', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Burdock', focus: 'social', homeStyle: 'workshop' },
  { name: 'Quill', focus: 'builder', homeStyle: 'treehouse' },
  { name: 'Marlow', focus: 'gatherer', homeStyle: 'cottage' },
  { name: 'Pip', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Hazel', focus: 'social', homeStyle: 'treehouse' },
  { name: 'Rook', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Tansy', focus: 'gatherer', homeStyle: 'workshop' },
  { name: 'Cobble', focus: 'builder', homeStyle: 'treehouse' },
  { name: 'Wren', focus: 'social', homeStyle: 'cottage' },
  { name: 'Bracken', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Sage', focus: 'gatherer', homeStyle: 'treehouse' },
  { name: 'Dill', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Moss', focus: 'social', homeStyle: 'workshop' },
  { name: 'Alder', focus: 'builder', homeStyle: 'treehouse' },
  { name: 'Fig', focus: 'gatherer', homeStyle: 'cottage' },
  { name: 'Birch', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Lark', focus: 'social', homeStyle: 'treehouse' },
  { name: 'Pebblin', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Rowan', focus: 'gatherer', homeStyle: 'workshop' },
  { name: 'Clover', focus: 'builder', homeStyle: 'treehouse' },
  { name: 'Thistle', focus: 'social', homeStyle: 'cottage' },
  { name: 'Ember', focus: 'builder', homeStyle: 'workshop' },
  { name: 'Nutmeg', focus: 'gatherer', homeStyle: 'treehouse' },
  { name: 'Briar', focus: 'builder', homeStyle: 'cottage' },
  { name: 'Juniperr', focus: 'social', homeStyle: 'workshop' },
  { name: 'Acorn', focus: 'builder', homeStyle: 'treehouse' },
];

/**
 * A lived-in demo village: residents who have been here a while, not eight identical arrivals. Some already
 * have a first home; each holds different stores and feels a little different. Token 0 (Mossy) stays a fresh
 * arrival on an empty lot, so the demo still shows a first build. Positions match SEEDS.
 */
interface History {
  homeLevel: number;
  stores: [wood: number, stone: number, food: number];
  needs: [energy: number, hunger: number, fun: number, social: number];
}
const HISTORIES: readonly (History | null)[] = [
  null,
  { homeLevel: 1, stores: [9, 3, 6], needs: [72, 64, 85, 70] },
  { homeLevel: 0, stores: [2, 5, 7], needs: [88, 76, 61, 82] },
  { homeLevel: 0, stores: [11, 8, 3], needs: [66, 58, 74, 79] },
  { homeLevel: 1, stores: [3, 6, 2], needs: [81, 70, 68, 63] },
  { homeLevel: 1, stores: [2, 1, 6], needs: [77, 83, 90, 92] },
  { homeLevel: 0, stores: [6, 1, 5], needs: [69, 88, 72, 66] },
  { homeLevel: 0, stores: [1, 2, 8], needs: [92, 71, 86, 88] },
];

export function fixtureIdentity(tokenId: string): AgentIdentity {
  return {
    chainId: FIXTURE_CHAIN_ID,
    registry: FIXTURE_REGISTRY,
    adapter: FIXTURE_ADAPTER,
    collection: FIXTURE_COLLECTION,
    tokenId,
    agentId: tokenId,
  };
}

/** Villagers already living in the fixture district. Villager C has not joined yet. */
const CITIZEN_SEEDS: ReadonlyArray<{ name: string; address: string; job: Job; look: VillagerLook }> = [
  { name: 'Nettle', address: '0x00000000000000000000000000000000c171ee01', job: 'farmhand', look: { Skin: 'Green', Head: 'Bucket Hat', Body: 'Vest', Eyes: 'Happy' } },
  { name: 'Basil', address: '0x00000000000000000000000000000000c171ee02', job: 'woodcutter', look: { Skin: 'Red', Head: 'Beanie', Body: 'Jacket', Eyes: 'Normal' } },
  { name: 'Poppy', address: '0x00000000000000000000000000000000c171ee03', job: 'quarrier', look: { Skin: 'Yellow', Head: 'Plumber', Body: 'Hoodie', Eyes: 'Glasses' } },
];

/** The books at genesis: the city's founding coins and one starting grant per seeded villager. */
export function fixtureGenesisAccounts(world: WorldState): AccountEntry[] {
  return [
    accountEntry('treasury', 'genesis', 'coins', 'grant', GENESIS_TREASURY_COINS),
    ...world.citizens.map((c) => accountEntry(c.key, `join:${c.key}`, 'coins', 'grant', CITIZEN_GRANT)),
  ];
}

/**
 * Fixture resident number `index` (its token ID too) on `plot`: holders alternate A, B, A, B. A newcomer starts
 * with the admission grant, as on the server; `history` gives a lived-in start instead.
 */
export function fixtureResident(index: number, plot: Plot, active: boolean, history: History | null = null): AgentState {
  const seed = SEEDS[index % SEEDS.length]!;
  const tokenId = String(index);
  const identity = fixtureIdentity(tokenId);
  const actor = index % 2 === 0 ? FIXTURE_ACTORS.A : FIXTURE_ACTORS.B;
  const [wood, stone, food] = history?.stores ?? [ADMISSION_GRANT.wood, ADMISSION_GRANT.stone, ADMISSION_GRANT.food];
  const [energy, hunger, fun, social] = history?.needs ?? [NEED_START, NEED_START, NEED_START, NEED_START];
  return {
    key: makeAgentKey(identity),
    identity,
    name: seed.name,
    control: {
      kind: 'controlled',
      controller: actor.address,
      epoch: '1',
      projectionGeneration: '1',
      blockNumber: '0',
      blockHash: '0x0',
      observedAtMs: 0,
    },
    controlAvailability: 'verified',
    plotId: plot.id,
    location: { kind: 'plot', plotId: plot.id },
    policy: { version: '1', active, focus: seed.focus, homeStyle: seed.homeStyle },
    inventory: {
      wood: { total: wood, reserved: 0 },
      stone: { total: stone, reserved: 0 },
      food: { total: food, reserved: 0 },
    },
    homeLevel: history?.homeLevel ?? 0,
    homeStyle: seed.homeStyle,
    construction: null,
    lastGreetingTick: null,
    needs: { energy, hunger, fun, social },
    decor: [],
    coins: 0,
    offer: null,
  };
}

/** `lived`: residents start with histories (the demo app); without it every resident is a fresh arrival (rules tests). */
export function makeFixtureWorld(options: { residentCount?: number; active?: boolean; citizenCount?: number; lived?: boolean } = {}): WorldState {
  const residentCount = options.residentCount ?? 8;
  const lots = worldData.lots as Lot[];
  const citizens: CitizenState[] = CITIZEN_SEEDS.slice(0, options.citizenCount ?? CITIZEN_SEEDS.length).map((seed, index) => ({
    key: citizenKeyOf(seed.address),
    address: seed.address,
    name: seed.name,
    look: seed.look,
    lotId: lots[index]!.id,
    location: { kind: 'lot', lotId: lots[index]!.id },
    job: seed.job,
    jobVersion: '1',
    coins: CITIZEN_GRANT,
    joinedTick: '0',
    // Old hands: the seeded villagers can already vote.
    activeDays: VOTE_ACTIVE_DAYS,
    lastWorkedDay: null,
    employer: null,
  }));
  const active = options.active ?? true;
  const plots = worldData.plots as Plot[];
  if (residentCount < 0 || residentCount > plots.length || residentCount > SEEDS.length) {
    throw new RangeError(`residentCount must be between 0 and ${plots.length}`);
  }

  const agents: AgentState[] = SEEDS.slice(0, residentCount).map((_, index) =>
    fixtureResident(index, plots[index]!, active, options.lived ? HISTORIES[index] ?? null : null),
  );

  return {
    cityId: worldData.cityId,
    tick: '0',
    seed: 'chog-city-fixture-1',
    rulesetVersion: RULESET_VERSION,
    places: worldData.places as Place[],
    plots,
    agents,
    lots,
    citizens,
    params: { version: '1', values: defaultParams() },
    treasury: { coins: GENESIS_TREASURY_COINS, stores: { wood: 0, stone: 0, food: 0 } },
    projects: emptyProjects(),
    proposals: [],
    proposalSeq: 0,
  };
}

export const WORLD_SIZE = { width: worldData.width, height: worldData.height };
