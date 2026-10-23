// Human-readable descriptions of residents and committed changes.
import type { AgentState, Focus, HomeStyle, Job, PlaceId, PublicChange, Resource, WorldState } from '../shared/contracts';
import { DECOR, GATHER_SITES, PROJECTS } from '../shared/rules';
import { isRestTick } from '../simulation/policies';
import type { Glyph } from './world/art';

export const FOCUS_LABEL: Record<Focus, string> = { builder: 'Builder', gatherer: 'Gatherer', social: 'Social' };
export const FOCUS_HINT: Record<Focus, string> = {
  builder: 'Gathers what the next home level needs, then builds it.',
  gatherer: 'Stockpiles wood, stone and food. Never builds.',
  social: 'Visits the plaza, tavern and workshop, greeting neighbours.',
};
export const STYLE_LABEL: Record<HomeStyle, string> = { cottage: 'Cottage', workshop: 'Workshop', treehouse: 'Treehouse' };
export const RESOURCE_LABEL: Record<Resource, string> = { wood: 'Wood', stone: 'Stone', food: 'Food' };

export function placeName(world: WorldState, id: PlaceId): string {
  return world.places.find((p) => p.id === id)?.name ?? id;
}

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export type Tone = 'ok' | 'warn' | 'alert' | 'muted';

export interface Activity {
  label: string;
  glyph: Glyph;
  tone: Tone;
}

export function activityOf(agent: AgentState, world: WorldState): Activity {
  if (agent.control.kind !== 'controlled') return { label: 'Ruins. This Chog was burned.', glyph: 'ruins', tone: 'muted' };
  if (agent.controlAvailability !== 'verified') {
    return { label: "Frozen. Ownership can't be verified right now.", glyph: 'frozen', tone: 'alert' };
  }
  if (!agent.policy.active) return { label: 'Paused by its holder', glyph: 'paused', tone: 'warn' };
  if (isRestTick(agent, world.tick)) {
    const bed = agent.homeLevel > 0 ? `their ${STYLE_LABEL[agent.homeStyle].toLowerCase()}` : 'their tent';
    const pausedBuild = agent.construction ? ' · building again at dawn' : '';
    return { label: `Asleep in ${bed}${pausedBuild}`, glyph: 'rest', tone: 'ok' };
  }
  if (agent.construction) {
    const n = agent.construction.remainingTicks;
    return {
      label: `Building level ${agent.construction.targetLevel} · ${n} ${n === 1 ? 'tick' : 'ticks'} left`,
      glyph: 'build',
      tone: 'ok',
    };
  }
  if (agent.location.kind === 'place') {
    const id = agent.location.placeId;
    const site = GATHER_SITES[id];
    if (site) return { label: `Gathering ${site.output} at ${placeName(world, id)}`, glyph: site.output, tone: 'ok' };
    if (agent.policy.focus === 'social') return { label: `Chatting at ${placeName(world, id)}`, glyph: 'social', tone: 'ok' };
    return { label: `At ${placeName(world, id)}`, glyph: 'home', tone: 'ok' };
  }
  return { label: 'At home', glyph: 'home', tone: 'ok' };
}

export const JOB_LABEL: Record<Job, string> = { farmhand: 'Farmhand', woodcutter: 'Woodcutter', quarrier: 'Quarrier', off: 'Day off' };

/** One sentence per meaningful change; routine moves and progress ticks are omitted. */
export function describeChange(change: PublicChange, world: WorldState): string | null {
  const name = (key: string) => world.agents.find((a) => a.key === key)?.name ?? 'A Chog';
  const citizen = (key: string) => world.citizens.find((c) => c.key === key)?.name ?? 'A villager';
  const party = (key: string) => (key.startsWith('citizen:') ? citizen(key) : name(key));
  const asset = (a: string, n: number) => (a === 'coins' ? `${n} ${n === 1 ? 'coin' : 'coins'}` : `${n} ${a}`);
  switch (change.type) {
    case 'gathered':
      return `${name(change.agentKey)} gathered ${change.amount} ${change.resource} at ${placeName(world, change.placeId)}.`;
    case 'build_started':
      return `${name(change.agentKey)} broke ground on a level ${change.targetLevel} home.`;
    case 'build_completed':
      return `${name(change.agentKey)} finished a level ${change.level} ${STYLE_LABEL[change.homeStyle].toLowerCase()}.`;
    case 'build_cancelled':
      return change.cause === 'control'
        ? `${name(change.agentKey)}'s build stopped when the Chog changed hands. Materials were returned.`
        : `${name(change.agentKey)}'s build was cancelled by a settings change. Materials were returned.`;
    case 'decorated':
      return `${name(change.agentKey)}'s home got a new ${DECOR[change.item].name.toLowerCase()}.`;
    case 'ate':
      return null;
    case 'greeted':
      return `${name(change.agentKey)} waved to ${name(change.otherKey)}.`;
    case 'policy_changed': {
      const p = change.policy;
      return p.active
        ? `${name(change.agentKey)} is now a ${FOCUS_LABEL[p.focus].toLowerCase()} with a ${STYLE_LABEL[p.homeStyle].toLowerCase()} plan.`
        : `${name(change.agentKey)} was paused.`;
    }
    case 'control_changed':
      if (change.availability === 'unavailable') return `${name(change.agentKey)} is frozen until ownership can be verified.`;
      if (change.control.kind === 'burned') return `${name(change.agentKey)} was burned. Its home is now ruins.`;
      return `${name(change.agentKey)} changed hands. It waits, paused, for its new holder.`;
    case 'citizen_joined':
      return `${change.name} moved into Newcomers' Row.`;
    case 'job_changed':
      return change.job === 'off' ? `${citizen(change.citizenKey)} took the day off.` : `${citizen(change.citizenKey)} is now a ${JOB_LABEL[change.job].toLowerCase()}.`;
    case 'params_changed':
      return `City Hall enacted new rules (version ${change.version}).`;
    case 'gift':
      return `${party(change.from)} gave ${party(change.to)} ${asset(change.asset, change.amount)}.`;
    case 'traded':
      return change.side === 'sell'
        ? `${name(change.agentKey)} sold ${change.amount} ${change.resource} at the market for ${change.coins} coins.`
        : `${name(change.agentKey)} bought ${change.amount} ${change.resource} at the market for ${change.coins} coins.`;
    case 'offer_posted':
      return change.offer
        ? `${name(change.agentKey)} is hiring a ${JOB_LABEL[change.offer.job].toLowerCase()} at ${change.offer.wage} coins a tick.`
        : `${name(change.agentKey)} stopped hiring.`;
    case 'hired':
      return change.employer ? `${citizen(change.citizenKey)} now works for ${name(change.employer)}.` : `${citizen(change.citizenKey)} works for the city again.`;
    case 'contributed':
      return `${party(change.from)} gave ${asset(change.asset, change.amount)} to the ${PROJECTS[change.projectId].name}.`;
    case 'project_completed':
      return `The ${PROJECTS[change.projectId].name} is finished! ${PROJECTS[change.projectId].effect}`;
    case 'proposal_opened':
      return `${name(change.proposer)} proposed: ${change.title}.`;
    case 'voted':
      return null;
    case 'spoke': {
      const title = world.proposals.find((p) => p.id === change.proposalId)?.title ?? 'a proposal';
      return `${name(change.agentKey)} spoke ${change.stance} "${title}": ${change.text}`;
    }
    case 'proposal_closed':
      return change.status === 'passed'
        ? `The vote passed, ${change.yes} to ${change.no}.${change.outcome ? ` ${change.outcome}` : ''}`
        : `The vote ${change.status === 'failed' ? 'passed but could not be carried out' : 'did not pass'} (${change.yes} yes, ${change.no} no). ${change.outcome ?? ''}`.trim();
    case 'citizen_worked':
    case 'citizen_moved':
    case 'moved':
      return null;
    case 'build_progressed':
    case 'idle':
      return null;
  }
}
