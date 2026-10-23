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
  C: { label: 'Citizen C', address: '0xc1c1000000000000000000000000000000000c1c' },
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

/** Villagers already living in the fixture district. Citizen C has not joined yet. */
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

export function makeFixtureWorld(options: { residentCount?: number; active?: boolean; citizenCount?: number } = {}): WorldState {
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

  const agents: AgentState[] = SEEDS.slice(0, residentCount).map((seed, index) => {
    const tokenId = String(index);
    const identity = fixtureIdentity(tokenId);
    const plot = plots[index]!;
    const actor = index % 2 === 0 ? FIXTURE_ACTORS.A : FIXTURE_ACTORS.B;
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
        wood: { total: ADMISSION_GRANT.wood, reserved: 0 },
        stone: { total: ADMISSION_GRANT.stone, reserved: 0 },
        food: { total: ADMISSION_GRANT.food, reserved: 0 },
      },
      homeLevel: 0,
      homeStyle: seed.homeStyle,
      construction: null,
      lastGreetingTick: null,
      needs: { energy: NEED_START, hunger: NEED_START, fun: NEED_START, social: NEED_START },
      decor: [],
      coins: 0,
      offer: null,
    };
  });

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
