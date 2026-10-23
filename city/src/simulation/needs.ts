// Sims-style needs, mood and home decorations. Pure functions of one resident; no clocks or randomness.
import { NEED_IDS, type AgentKey, type AgentState, type DecorId, type LedgerEntry, type Need, type Needs, type PublicChange, type WorldState } from '../shared/contracts';
import {
  DECOR,
  DECOR_FUN_WHILE_RESTING,
  EAT_GAIN,
  HUNGRY_BELOW,
  MAX_DECOR,
  NEED_EFFECTS,
  NEED_MAX,
  REST_ENERGY_PER_LEVEL,
} from '../shared/rules';
import { applyLedger, available, canAfford, line } from './resources';
import type { Intent } from './policies';

const clamp = (value: number) => Math.max(0, Math.min(NEED_MAX, value));

/** One tick of needs after the Chog acted. Idle (paused, frozen, ruins) changes nothing. `asleep`: night-time sleep. */
export function liveNeeds(agent: AgentState, intent: Intent['kind'], causeId: string, asleep = intent === 'rest'): { agent: AgentState; ledger: LedgerEntry[]; changes: PublicChange[] } {
  if (intent === 'idle') return { agent, ledger: [], changes: [] };
  const effect = intent === 'socialize' ? NEED_EFFECTS.socialize : intent === 'rest' ? NEED_EFFECTS.rest : NEED_EFFECTS.work;
  const needs = { ...agent.needs };
  for (const need of NEED_IDS) needs[need] = clamp(needs[need] + effect[need]);
  if (intent === 'rest') {
    needs.energy = clamp(needs.energy + REST_ENERGY_PER_LEVEL * agent.homeLevel);
    needs.fun = clamp(needs.fun + DECOR_FUN_WHILE_RESTING * agent.decor.length);
  }
  // Sleepers don't touch their stores (night is no-progress time); a hungry Chog eats once it is up.
  if (asleep || needs.hunger >= HUNGRY_BELOW || available(agent.inventory, 'food') < 1) return { agent: { ...agent, needs }, ledger: [], changes: [] };
  const ledger = [line(agent.key, causeId, 'food', 'eat', -1, 0)];
  needs.hunger = clamp(needs.hunger + EAT_GAIN);
  return {
    agent: { ...agent, needs, inventory: applyLedger(agent.inventory, ledger) },
    ledger,
    changes: [{ type: 'ate', agentKey: agent.key }],
  };
}

export type MoodKind = 'cheerful' | 'content' | 'tired' | 'hungry' | 'bored' | 'lonely' | 'miserable';

const LOW_MOOD: Record<Need, MoodKind> = { energy: 'tired', hunger: 'hungry', fun: 'bored', social: 'lonely' };

/** Mood from needs (decorations brighten it): the lowest need names a bad mood. */
export function moodOf(agent: Pick<AgentState, 'needs' | 'decor'>): { kind: MoodKind; score: number } {
  const values = NEED_IDS.map((need) => agent.needs[need]);
  const score = clamp(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) + 3 * agent.decor.length);
  const lowest = NEED_IDS.reduce((low, need) => (agent.needs[need] < agent.needs[low] ? need : low), NEED_IDS[0]);
  if (agent.needs[lowest] < 30) return { kind: score < 30 ? 'miserable' : LOW_MOOD[lowest], score };
  return { kind: score >= 70 ? 'cheerful' : 'content', score };
}

export type DecorRefusal = 'ALREADY_OWNED' | 'DECOR_FULL' | 'CANT_AFFORD';

/** A holder buys a decoration with the Chog's own available stores. Doesn't touch reserved materials. */
export function applyDecor(
  world: WorldState,
  key: AgentKey,
  item: DecorId,
  causeId: string,
): { ok: true; world: WorldState; ledger: LedgerEntry[]; changes: PublicChange[] } | { ok: false; code: DecorRefusal } {
  const index = world.agents.findIndex((agent) => agent.key === key);
  if (index < 0) throw new Error(`unknown agent ${key}`);
  const agent = world.agents[index]!;
  if (agent.decor.includes(item)) return { ok: false, code: 'ALREADY_OWNED' };
  if (agent.decor.length >= MAX_DECOR) return { ok: false, code: 'DECOR_FULL' };
  const { costs } = DECOR[item];
  if (!canAfford(agent.inventory, costs)) return { ok: false, code: 'CANT_AFFORD' };
  const ledger = (['wood', 'stone', 'food'] as const).filter((r) => costs[r] > 0).map((r) => line(key, causeId, r, 'decor', -costs[r], 0));
  const updated: AgentState = { ...agent, inventory: applyLedger(agent.inventory, ledger), decor: [...agent.decor, item] };
  const agents = world.agents.slice();
  agents[index] = updated;
  return { ok: true, world: { ...world, agents }, ledger, changes: [{ type: 'decorated', agentKey: key, item }] };
}

export type { Needs };
