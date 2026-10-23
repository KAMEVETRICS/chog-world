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

/** Lowest stock first; ties break in canonical order wood > stone > food. */
function stockpile(agent: AgentState, params: Params): Intent {
  const ordered = [...RESOURCES].sort((a, b) => agent.inventory[a].total - agent.inventory[b].total);
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
  const material = (['wood', 'stone'] as const).filter((r) => deficit(r) > 0).sort((a, b) => deficit(b) - deficit(a))[0];
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

/** Where social residents meet this tick: everyone together, moving on every SOCIAL_STAY_TICKS. */
export function socialPlace(tick: string): PlaceId {
  return SOCIAL_PLACES[Number((BigInt(tick) / BigInt(SOCIAL_STAY_TICKS)) % BigInt(SOCIAL_PLACES.length))]!;
}

/** Hour of the village day for a tick: 0 at dawn, DAY_TICKS - 1 just before the next dawn. */
export function hourOf(tick: string): number {
  return Number((BigInt(tick) + BigInt(DAY_START_TICK)) % BigInt(DAY_TICKS));
}

/** Night-time sleep at home. Bedtimes are staggered by token ID, so identical residents don't move in lockstep. */
export function isRestTick(agent: AgentState, tick: string): boolean {
  const hour = hourOf(tick);
  const bedtime = BEDTIME_TICK + Number(BigInt(agent.identity.tokenId) % BigInt(BEDTIME_SPREAD));
  return hour >= bedtime && hour < WAKE_TICK;
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
  return low || recovering ? { kind: 'socialize', placeId: socialPlace(tick) } : null;
}

export function decide(agent: AgentState, tick: string, params: Params = DEFAULT_PARAMS): Intent {
  if (agent.control.kind !== 'controlled') return { kind: 'idle', reason: 'ruins' };
  if (agent.controlAvailability !== 'verified') return { kind: 'idle', reason: 'unavailable' };
  if (!agent.policy.active) return { kind: 'idle', reason: 'paused' };
  if (isRestTick(agent, tick)) return { kind: 'rest' };
  const needed = needsFirst(agent, tick, params);
  if (needed) return needed;
  switch (agent.policy.focus) {
    case 'builder':
      return build(agent, params);
    case 'gatherer':
      return stockpile(agent, params);
    case 'social':
      return { kind: 'socialize', placeId: socialPlace(tick) };
  }
}
