// The one versioned source of every game number. Change RULESET_VERSION when any value changes.
//
// Checked against docs/superpowers/specs/2026-10-19-chog-city-design.md §3: admission grant 4/2/4,
//   level-1 cost 6/4/2 and level-2 cost 12/8/4, each over 2 eligible ticks, max home level 2,
//   forest +3 wood for 1 food, quarry +2 stone for 1 food, farm +3 food with no input, cap 20,
//   greeting cooldown 6, 10-second ticks, at most 3 catch-up ticks, 8-second observation staleness.
// Added beyond the spec: the night rhythm (residents sleep in their own home each village night,
//   bedtimes staggered by token ID so otherwise identical residents fall out of lockstep) and the
//   social rotation between the three places Cult counts.
import type { DecorId, HomeStyle, Job, Needs, Params, PlaceId, ProjectAmounts, ProjectId, Resource, ResourceAmounts, VillagerLook } from './contracts';

export const RULESET_VERSION = 'city-m3-life';
export const TICK_MS = 10_000;
export const RESOURCE_CAP = 20;
export const GREETING_COOLDOWN_TICKS = 6;
/** One village day lasts 36 ticks (6 minutes at 10-second ticks). */
export const DAY_TICKS = 36;
/** Tick 0 falls this many ticks after dawn (mid-morning). */
export const DAY_START_TICK = 4;
/** Hour of the day (0 = dawn) when the earliest residents go to bed; each token ID adds 0-2 ticks. */
export const BEDTIME_TICK = 19;
export const BEDTIME_SPREAD = 3;
/** The earliest risers are up at this hour; each token ID may lie in up to WAKE_SPREAD - 1 ticks more. Sleep ticks are not eligible build ticks. */
export const WAKE_TICK = 34;
export const WAKE_SPREAD = 2;
/** Workers' midday break: LUNCH_TICKS at the tavern, starting at an hour between these, set per resident. */
export const LUNCH_EARLIEST = 8;
export const LUNCH_LATEST = 14;
export const LUNCH_TICKS = 2;
export const LUNCH_PLACE: PlaceId = 'tavern';
/** Social residents go to bed this many ticks later than workers. */
export const NIGHT_OWL_TICKS = 3;
/** A builder weighs up to this much spare wood or stone (set per resident) when choosing what to fetch next. */
export const MAX_SPARE = 4;
/** Social residents make a round of the places Cult counts, staying this many ticks at each (each starts its stay at its own phase). */
export const SOCIAL_PLACES = ['plaza', 'tavern', 'workshop'] as const satisfies readonly PlaceId[];
export const SOCIAL_STAY_TICKS = 4;
export const STALE_OBSERVATION_MS = 8_000;
export const MAX_CATCH_UP_TICKS = 3;

export const ADMISSION_GRANT: ResourceAmounts = { wood: 4, stone: 2, food: 4 };

export interface GatherRecipe {
  output: Resource;
  yield: number;
  input: { resource: Resource; amount: number } | null;
}

export const GATHER_SITES: Partial<Record<PlaceId, GatherRecipe>> = {
  forest: { output: 'wood', yield: 3, input: { resource: 'food', amount: 1 } },
  quarry: { output: 'stone', yield: 2, input: { resource: 'food', amount: 1 } },
  farm: { output: 'food', yield: 3, input: null },
};

/** Site for each resource, in canonical tie-break order (wood, stone, food). */
export const SITE_FOR: Record<Resource, PlaceId> = { wood: 'forest', stone: 'quarry', food: 'farm' };

export interface HomeRecipe {
  level: number;
  costs: ResourceAmounts;
  /** Eligible progress ticks after the start tick. */
  buildTicks: number;
}

/**
 * Five levels, each costlier and slower than the last. The top levels need a nearly full storehouse: every cost
 * stays reachable under RESOURCE_CAP, given each site's yield (wood <= 20 - 3, stone <= 20 - 2).
 */
export const HOME_RECIPES: readonly HomeRecipe[] = [
  { level: 1, costs: { wood: 6, stone: 4, food: 2 }, buildTicks: 2 },
  { level: 2, costs: { wood: 12, stone: 8, food: 4 }, buildTicks: 2 },
  { level: 3, costs: { wood: 15, stone: 12, food: 6 }, buildTicks: 3 },
  { level: 4, costs: { wood: 17, stone: 15, food: 8 }, buildTicks: 4 },
  { level: 5, costs: { wood: 17, stone: 18, food: 10 }, buildTicks: 5 },
];
export const MAX_HOME_LEVEL = HOME_RECIPES.length;

/** What one tick of work at a gathering site yields, from the live parameters (see constitution.ts). */
export function siteYield(placeId: PlaceId, params: Params): number {
  if (placeId === 'farm') return params.farmYield;
  if (placeId === 'forest') return params.forestYield;
  if (placeId === 'quarry') return params.quarryYield;
  return 0;
}

export function recipeForLevel(level: number): HomeRecipe | undefined {
  return HOME_RECIPES.find((r) => r.level === level);
}

export const DEFAULT_HOME_STYLE: HomeStyle = 'cottage';

// ---- Needs, mood and decorations (Sims-style; beyond the design spec) ----
// Needs run 0-100. Paused, frozen and ruined Chogs don't change: they are out of play.

export const NEED_START = 80;
export const NEED_MAX = 100;
/** Per-tick change by the kind of thing the Chog did. */
export const NEED_EFFECTS: Record<'work' | 'socialize' | 'rest', Needs> = {
  work: { energy: -4, hunger: -3, fun: -1, social: -1 },
  socialize: { energy: -2, hunger: -2, fun: 6, social: 15 },
  rest: { energy: 12, hunger: -1, fun: 0, social: -1 },
};
/** A house sleeps better than a tent: extra energy per home level while resting. */
export const REST_ENERGY_PER_LEVEL = 4;
/** Each decoration adds fun while the Chog is at home resting. */
export const DECOR_FUN_WHILE_RESTING = 2;
/** Below this hunger a Chog eats 1 food from its own available stores, gaining EAT_GAIN. */
export const HUNGRY_BELOW = 35;
export const EAT_GAIN = 45;
/** Below this, a need overrides focus: too tired, it rests at home; too lonely, it goes where the social Chogs are. */
export const URGENT_BELOW = 20;
/** A Chog that went out for company stays until social and fun are both back to this. */
export const SOCIAL_ENOUGH = 60;

// ---- Citizens and city money (open City; beyond the design spec) ----
// Anyone can join as a citizen with a Chog-like villager. Citizens work for the city: what they produce goes
// to the treasury's stores, and the city pays a wage in new coins (the money supply), taxed by the
// constitution's income tax. Yields, wage and tax are live parameters (constitution.ts), not constants.

/** Coins every new citizen starts with. */
export const CITIZEN_GRANT = 10;
/** The treasury's stores hold at most this much of each resource; work stops paying when they are full. */
export const TREASURY_CAP = 500;
/** Village days worked before a citizen may vote. */
export const VOTE_ACTIVE_DAYS = 3;
/** Citizens go home for the night at this hour (staggered by address), and are up again at WAKE_TICK. */
export const CITIZEN_BEDTIME_TICK = 20;
export const JOB_SITE: Record<Exclude<Job, 'off'>, PlaceId> = { farmhand: 'farm', woodcutter: 'forest', quarrier: 'quarry' };

/** Plain villager looks; the rarer Chog Genesis traits stay with the NFTs. */
export const VILLAGER_OPTIONS: { readonly [K in keyof VillagerLook]: readonly string[] } = {
  Skin: ['Origin', 'Pink', 'Red', 'Yellow', 'Blue', 'White', 'Green', 'Beige'],
  Head: ['None', 'Beanie', 'Bucket Hat', 'Plumber', 'Bandana'],
  Body: ['None', 'Hoodie', 'Vest', 'Jacket'],
  Eyes: ['Normal', 'Happy', 'Glasses'],
};

// ---- The economy: gifts, the Plaza market, hiring and shared projects ----
// Coins exist only in the game. The treasury is the market: it buys and sells materials at a price that
// rises when its stores are low and falls when they are full, and keeps the market fee.

/** Coins the city is founded with, so the market can buy before any tax has come in. */
export const GENESIS_TREASURY_COINS = 100;
/** Market price per unit when the treasury holds MARKET_PIVOT of it; double when empty. */
export const MARKET_BASE: ResourceAmounts = { wood: 3, stone: 4, food: 2 };
export const MARKET_PIVOT = 50;
/** Most units in one trade or gift. */
export const MAX_TRADE = 10;
/** Wages a Chog may offer per tick worked. */
export const OFFER_WAGE_MIN = 1;
export const OFFER_WAGE_MAX = 10;

export const PROJECTS: Record<ProjectId, { name: string; needs: ProjectAmounts; effect: string }> = {
  fountain: {
    name: 'Plaza Fountain',
    needs: { wood: 10, stone: 20, food: 0, coins: 30 },
    effect: 'Chogs chatting at Lantern Plaza have extra fun.',
  },
  market_hall: {
    name: 'Market Hall',
    needs: { wood: 25, stone: 15, food: 0, coins: 50 },
    effect: 'Halves the market fee.',
  },
};
// ---- Proposals and votes (the rules of voting are not themselves votable) ----

/** A proposal is open for one village day. */
export const VOTE_TICKS = DAY_TICKS;
/** Turnout needed, as a share of citizens who can vote (at least one ballot). */
export const QUORUM_PCT = 25;
/** Open proposals at once, city-wide and per Chog. */
export const MAX_OPEN_PROPOSALS = 5;
export const MAX_OPEN_PER_CHOG = 1;
/** Closed proposals kept in the world for the record (older ones live in the event log). */
export const KEEP_CLOSED_PROPOSALS = 20;

/** The council meets once a village day at this hour (0 = dawn): every active Chog speaks on open proposals. */
export const COUNCIL_HOUR = 2;
/** Longest speech and longest standing instructions, in characters. */
export const MAX_SPEECH = 280;
export const MAX_INSTRUCTIONS = 600;

/** Extra fun per tick for a Chog socializing at the Plaza once the fountain stands. */
export const FOUNTAIN_FUN = 3;

export const MAX_DECOR = 4;
export const DECOR: Record<DecorId, { name: string; costs: ResourceAmounts }> = {
  lantern: { name: 'Lantern', costs: { wood: 2, stone: 0, food: 0 } },
  flowerbed: { name: 'Flower bed', costs: { wood: 0, stone: 0, food: 3 } },
  bench: { name: 'Bench', costs: { wood: 3, stone: 1, food: 0 } },
  well: { name: 'Well', costs: { wood: 1, stone: 4, food: 0 } },
};
