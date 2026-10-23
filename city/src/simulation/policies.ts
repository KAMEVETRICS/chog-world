// Builder / gatherer / social decisions. Pure functions of one resident's state; no clocks, no randomness.
import { RESOURCES, type AgentState, type Params, type PlaceId, type Resource } from '../shared/contracts';
import { defaultParams } from '../shared/constitution';
import {
  BEDTIME_SPREAD,
  BEDTIME_TICK,
  DAY_START_TICK,
  DAY_TICKS,
  GATHER_SITES,
  HUNGRY_BELOW,
  RESOURCE_CAP,
  SITE_FOR,
  siteYield,
  SOCIAL_ENOUGH,
  SOCIAL_PLACES,
  SOCIAL_STAY_TICKS,
  URGENT_BELOW,
  LUNCH_EARLIEST,
  LUNCH_LATEST,
  LUNCH_PLACE,
  LUNCH_TICKS,
  MAX_SPARE,
  NIGHT_OWL_TICKS,
  WAKE_SPREAD,
  WAKE_TICK,
} from '../shared/rules';
import { nextRecipe } from './construction';
import { available, canAfford } from './resources';

export type Intent =
  | { kind: 'idle'; reason: 'paused' | 'unavailable' | 'ruins' }
  | { kind: 'gather'; placeId: PlaceId }
  | { kind: 'build_start' }
  | { kind: 'build_progress' }
  | { kind: 'socialize'; placeId: PlaceId }
  | { kind: 'rest' };

/** A site is worth visiting only if its input is on hand and its full yield fits (no wasted input). */
/** Used when no live parameters are given (tests, previews). */
const DEFAULT_PARAMS = defaultParams();

export function canGather(agent: AgentState, placeId: PlaceId, params: Params = DEFAULT_PARAMS): boolean {
  const recipe = GATHER_SITES[placeId];
  if (!recipe) return false;
  const out = agent.inventory[recipe.output];
  if (recipe.input) {
    if (available(agent.inventory, recipe.input.resource) < recipe.input.amount) return false;
    return out.total + siteYield(placeId, params) <= RESOURCE_CAP;
  }
  return out.total < RESOURCE_CAP;
}

/**
 * A resident's habits, fixed by its token ID so every replay agrees: which material it reaches for first
 * when two are equally needed, when in the social round it moves on, and whether it lies in at dawn.
 * Identical residents would otherwise make identical choices on the same tick and move as a herd.
 */
export function temperament(agent: Pick<AgentState, 'identity'>): {
  prefers: readonly Resource[];
  socialPhase: number;
  lieIn: number;
  /** First hour of its midday break. */
  lunchHour: number;
  /** Spare wood and stone it likes to have on hand beyond what the next home needs. */
  spare: { wood: number; stone: number };
} {
  const id = BigInt(agent.identity.tokenId);
  const turn = Number(id % BigInt(RESOURCES.length));
  // A multiplicative hash (offset so token 0 isn't all zeros), so neighbouring IDs get unrelated habits.
  const mixed = ((id + 1n) * 2654435761n) % 4294967296n;
  return {
    prefers: [...RESOURCES.slice(turn), ...RESOURCES.slice(0, turn)],
    socialPhase: Number((id / 3n) % BigInt(SOCIAL_STAY_TICKS)),
    lieIn: Number((id / 2n) % BigInt(WAKE_SPREAD)),
    lunchHour: LUNCH_EARLIEST + Number((mixed >> 7n) % BigInt(LUNCH_LATEST - LUNCH_EARLIEST + 1)),
    spare: { wood: Number((mixed >> 13n) % BigInt(MAX_SPARE + 1)), stone: Number((mixed >> 19n) % BigInt(MAX_SPARE + 1)) },
  };
}

/** Its midday break: workers down tools for LUNCH_TICKS at their own hour and eat at the tavern. */
export function onLunch(agent: AgentState, tick: string): boolean {
  if (agent.policy.focus === 'social') return false;
  const hour = hourOf(tick);
  const start = temperament(agent).lunchHour;
  return hour >= start && hour < start + LUNCH_TICKS;
}

/** Rank of a resource in this resident's preferences (lower comes first). */
const preference = (agent: AgentState, r: Resource) => temperament(agent).prefers.indexOf(r);

/** Lowest stock first; ties break by the resident's own preference. */
function stockpile(agent: AgentState, params: Params): Intent {
  const ordered = [...RESOURCES].sort((a, b) => agent.inventory[a].total - agent.inventory[b].total || preference(agent, a) - preference(agent, b));
  for (const resource of ordered) {
    if (canGather(agent, SITE_FOR[resource], params)) return { kind: 'gather', placeId: SITE_FOR[resource] };
  }
  return { kind: 'rest' };
}

function build(agent: AgentState, params: Params): Intent {
  if (agent.construction) return { kind: 'build_progress' };
  const recipe = nextRecipe(agent);
  if (!recipe) return stockpile(agent, params);
  if (canAfford(agent.inventory, recipe.costs)) return { kind: 'build_start' };

  const deficit = (r: Resource) => Math.max(0, recipe.costs[r] - available(agent.inventory, r));
  // Already working a site that still helps: keep at it rather than re-choosing every hour.
  const here = agent.location.kind === 'place' ? agent.location.placeId : null;
  const output = here ? GATHER_SITES[here]?.output : undefined;
  if (here && output && deficit(output) > 0 && canGather(agent, here, params)) {
    const input = GATHER_SITES[here]?.input;
    const foodLeft = available(agent.inventory, 'food') - (input?.amount ?? 0);
    if (output === 'food' || foodLeft >= recipe.costs.food) return { kind: 'gather', placeId: here };
  }
  // Which material to fetch next: the biggest shortfall, counting the spare this resident likes to keep.
  const { spare } = temperament(agent);
  const shortfall = (r: 'wood' | 'stone') => deficit(r) + (deficit(r) > 0 ? spare[r] : 0);
  const material = (['wood', 'stone'] as const).filter((r) => deficit(r) > 0).sort((a, b) => shortfall(b) - shortfall(a) || preference(agent, a) - preference(agent, b))[0];
  if (material) {
    // Keep enough food for the recipe plus this trip's input; otherwise farm first.
    const input = GATHER_SITES[SITE_FOR[material]]?.input?.amount ?? 0;
    if (available(agent.inventory, 'food') < recipe.costs.food + input && canGather(agent, 'farm', params)) {
      return { kind: 'gather', placeId: 'farm' };
    }
    if (canGather(agent, SITE_FOR[material], params)) return { kind: 'gather', placeId: SITE_FOR[material] };
  } else if (deficit('food') > 0 && canGather(agent, 'farm', params)) {
    return { kind: 'gather', placeId: 'farm' };
  }
  return stockpile(agent, params);
}

/**
 * Where a social resident meets others this tick. Everyone makes the same round (Plaza, Tavern, Workshop,
 * SOCIAL_STAY_TICKS at each), but a resident's phase shifts when it moves on, so friends arrive and leave at
 * different times instead of as one crowd, and still spend most of each stop together.
 */
export function socialPlace(tick: string, phase = 0): PlaceId {
  return SOCIAL_PLACES[Number(((BigInt(tick) + BigInt(phase)) / BigInt(SOCIAL_STAY_TICKS)) % BigInt(SOCIAL_PLACES.length))]!;
}

/** Hour of the village day for a tick: 0 at dawn, DAY_TICKS - 1 just before the next dawn. */
export function hourOf(tick: string): number {
  return Number((BigInt(tick) + BigInt(DAY_START_TICK)) % BigInt(DAY_TICKS));
}

/** Night-time sleep at home. Bedtimes and wake-ups are staggered by token ID, so residents don't move in lockstep. */
export function isRestTick(agent: AgentState, tick: string): boolean {
  const hour = hourOf(tick);
  // Social residents are the village's night owls: they keep the tavern lively a few hours longer.
  const owl = agent.policy.focus === 'social' ? NIGHT_OWL_TICKS : 0;
  const bedtime = BEDTIME_TICK + owl + Number(BigInt(agent.identity.tokenId) % BigInt(BEDTIME_SPREAD));
  return hour >= bedtime && hour < WAKE_TICK + temperament(agent).lieIn;
}

/**
 * Urgent needs come before focus (a build in progress is finished first): Sims-style autonomy. Too tired, a
 * Chog rests; hungry with no free food, it farms; lonely or bored, it goes where the others meet and stays
 * until it feels better.
 */
function needsFirst(agent: AgentState, tick: string, params: Params): Intent | null {
  if (agent.construction) return null;
  const { needs } = agent;
  if (needs.energy < URGENT_BELOW) return { kind: 'rest' };
  if (needs.hunger < HUNGRY_BELOW && available(agent.inventory, 'food') < 1 && canGather(agent, 'farm', params)) return { kind: 'gather', placeId: 'farm' };
  if (agent.policy.focus === 'social') return null;
  const socializing = agent.location.kind === 'place' && (SOCIAL_PLACES as readonly PlaceId[]).includes(agent.location.placeId);
  const low = needs.social < URGENT_BELOW || needs.fun < URGENT_BELOW;
  const recovering = socializing && (needs.social < SOCIAL_ENOUGH || needs.fun < SOCIAL_ENOUGH);
  return low || recovering ? { kind: 'socialize', placeId: socialPlace(tick, temperament(agent).socialPhase) } : null;
}

export function decide(agent: AgentState, tick: string, params: Params = DEFAULT_PARAMS): Intent {
  if (agent.control.kind !== 'controlled') return { kind: 'idle', reason: 'ruins' };
  if (agent.controlAvailability !== 'verified') return { kind: 'idle', reason: 'unavailable' };
  if (!agent.policy.active) return { kind: 'idle', reason: 'paused' };
  if (isRestTick(agent, tick)) return { kind: 'rest' };
  const needed = needsFirst(agent, tick, params);
  if (needed) return needed;
  if (onLunch(agent, tick) && !agent.construction) return { kind: 'socialize', placeId: LUNCH_PLACE };
  switch (agent.policy.focus) {
    case 'builder':
      return build(agent, params);
    case 'gatherer':
      return stockpile(agent, params);
    case 'social':
      return { kind: 'socialize', placeId: socialPlace(tick, temperament(agent).socialPhase) };
  }
}
