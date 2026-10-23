// How grown the village is: Hamlet, Village, Town, City. Everyone pushes it together, and every point comes
// from something the world already records, so the rank can't be gamed by anything but building the place.
import { PROJECT_IDS, type WorldState } from '../../shared/contracts';
import { MAX_HOME_LEVEL } from '../../shared/rules';

export interface Rank {
  name: string;
  /** Growth needed to reach this rank. */
  from: number;
}

/**
 * Tuned to today's map (12 Chog plots, 30 villager lots, 2 projects: at most 106 growth). City asks for a
 * nearly finished village; `maxGrowth` and its test keep every rank within reach if the map or scoring changes.
 */
export const RANKS: readonly Rank[] = [
  { name: 'Hamlet', from: 0 },
  { name: 'Village', from: 25 },
  { name: 'Town', from: 55 },
  { name: 'City', from: 90 },
];

/** What counts towards growth, in plain words (shown to players). */
export const GROWTH_RULES = {
  homeLevel: 1,
  villager: 1,
  project: 8,
} as const;

/** The most growth this village can ever reach: every plot at the top home level, every lot taken, every project built. */
export function maxGrowth(world: Pick<WorldState, 'plots' | 'lots'>): number {
  return world.plots.length * MAX_HOME_LEVEL * GROWTH_RULES.homeLevel + world.lots.length * GROWTH_RULES.villager + PROJECT_IDS.length * GROWTH_RULES.project;
}

export interface Growth {
  points: number;
  rank: Rank;
  next: Rank | null;
  /** 0..1 progress from this rank to the next (1 at the top). */
  progress: number;
  /** 0..1 along the whole road from Hamlet to City, each rank an equal stretch. */
  journey: number;
}

export function growthOf(world: WorldState): Growth {
  const homes = world.agents.filter((a) => a.control.kind === 'controlled').reduce((sum, a) => sum + a.homeLevel, 0);
  const projects = PROJECT_IDS.filter((id) => world.projects[id].completedTick !== null).length;
  const points = homes * GROWTH_RULES.homeLevel + world.citizens.length * GROWTH_RULES.villager + projects * GROWTH_RULES.project;
  const index = RANKS.reduce((at, r, i) => (points >= r.from ? i : at), 0);
  const rank = RANKS[index]!;
  const next = RANKS[index + 1] ?? null;
  const progress = next ? (points - rank.from) / (next.from - rank.from) : 1;
  return { points, rank, next, progress, journey: next ? (index + progress) / (RANKS.length - 1) : 1 };
}
