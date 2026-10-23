// Pure world transitions: next tick, holder policy change, ownership/control change.
// None of these mutate their input or read clocks, randomness or the network.
import type {
  AccountEntry,
  AgentKey,
  AgentState,
  ControlObservation,
  LedgerEntry,
  Location,
  Policy,
  PublicChange,
  TickActivity,
  TickInput,
  TickResult,
  WorldState,
} from '../shared/contracts';
import { DEFAULT_HOME_STYLE, FOUNTAIN_FUN, GATHER_SITES, GREETING_COOLDOWN_TICKS, NEED_MAX, RESOURCE_CAP, siteYield } from '../shared/rules';
import type { Params } from '../shared/contracts';
import { stepCitizens } from './citizens';
import { resolveProposals } from './governance';
import { cancelConstruction, progressConstruction, startConstruction } from './construction';
import { decide, isRestTick, type Intent } from './policies';
import { liveNeeds } from './needs';
import { applyLedger, line } from './resources';

// ---------------------------------------------------------------------------------------------
// Hashing: canonical JSON (sorted keys) folded through two 32-bit FNV-1a lanes -> 16 hex chars.

// Every tick hashes the whole world, so this is a hot path: plain loops, but the same text as
// `canonicalJsonReference` (map/filter/sort/join), which tests compare it against.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i += 1) out += (i ? ',' : '') + canonicalJson(value[i]);
    return out + ']';
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    let out = '{';
    let first = true;
    for (const k of Object.keys(record).sort()) {
      const v = record[k];
      if (v === undefined) continue;
      out += (first ? '' : ',') + JSON.stringify(k) + ':' + canonicalJson(v);
      first = false;
    }
    return out + '}';
  }
  return JSON.stringify(value);
}

/** The original, readable formulation of canonicalJson. */
export function canonicalJsonReference(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonReference).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonReference(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value: unknown): string {
  const text = canonicalJson(value);
  let a = 0x811c9dc5;
  let b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (a >>> 13);
  }
  return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'));
}

export const hashWorld = (world: WorldState): string => hashJson(world);

// ---------------------------------------------------------------------------------------------

const sameLocation = (a: Location, b: Location) =>
  a.kind === b.kind && (a.kind === 'place' ? a.placeId === (b as typeof a).placeId : a.plotId === (b as typeof a).plotId);

const byKey = (a: AgentState, b: AgentState) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

function findAgent(world: WorldState, key: AgentKey): number {
  const index = world.agents.findIndex((a) => a.key === key);
  if (index < 0) throw new Error(`unknown agent ${key}`);
  return index;
}

function replaceAgent(world: WorldState, index: number, agent: AgentState): WorldState {
  const agents = world.agents.slice();
  agents[index] = agent;
  return { ...world, agents };
}

function noChange(world: WorldState): TickResult {
  return { world, ledger: [], accounts: [], changes: [], activities: [], actionCount: 0, resultHash: hashWorld(world) };
}

interface Acted {
  agent: AgentState;
  ledger: LedgerEntry[];
  changes: PublicChange[];
  acted: boolean;
}

function act(agent: AgentState, intent: Intent, tick: string, params: Params): Acted {
  const causeId = `tick:${tick}:${agent.key}`;
  const changes: PublicChange[] = [];
  let next: AgentState = agent;

  const moveTo = (to: Location) => {
    if (sameLocation(next.location, to)) return;
    next = { ...next, location: to };
    changes.push({ type: 'moved', agentKey: agent.key, to });
  };
  const home: Location = { kind: 'plot', plotId: agent.plotId };

  switch (intent.kind) {
    case 'idle':
      return { agent, ledger: [], changes: [], acted: false };

    case 'gather': {
      const recipe = GATHER_SITES[intent.placeId]!;
      moveTo({ kind: 'place', placeId: intent.placeId });
      const amount = Math.min(siteYield(intent.placeId, params), RESOURCE_CAP - agent.inventory[recipe.output].total);
      const ledger: LedgerEntry[] = [];
      if (recipe.input) ledger.push(line(agent.key, causeId, recipe.input.resource, 'gather_input', -recipe.input.amount, 0));
      ledger.push(line(agent.key, causeId, recipe.output, 'gather_output', amount, 0));
      next = { ...next, inventory: applyLedger(agent.inventory, ledger) };
      changes.push({ type: 'gathered', agentKey: agent.key, placeId: intent.placeId, resource: recipe.output, amount });
      return { agent: next, ledger, changes, acted: true };
    }

    case 'build_start': {
      moveTo(home);
      const started = startConstruction(agent, tick, causeId);
      next = { ...next, construction: started.construction, inventory: applyLedger(agent.inventory, started.ledger) };
      return { agent: next, ledger: started.ledger, changes: [...changes, ...started.changes], acted: true };
    }

    case 'build_progress': {
      moveTo(home);
      const progressed = progressConstruction(agent, agent.construction!, causeId);
      next = {
        ...next,
        construction: progressed.construction,
        inventory: applyLedger(agent.inventory, progressed.ledger),
        ...(progressed.completed
          ? { homeLevel: agent.construction!.targetLevel, homeStyle: agent.policy.homeStyle }
          : {}),
      };
      return { agent: next, ledger: progressed.ledger, changes: [...changes, ...progressed.changes], acted: true };
    }

    case 'socialize':
      moveTo({ kind: 'place', placeId: intent.placeId });
      return { agent: next, ledger: [], changes, acted: true };

    case 'rest':
      moveTo(home);
      return { agent: next, ledger: [], changes, acted: true };
  }
}

/** How each acting intent is reported to Cult. Sleeping at home is idle; only visits and greets earn presence. */
const ACTIVITY_KIND: Record<Intent['kind'], TickActivity['kind']> = {
  idle: 'idle',
  gather: 'gather',
  build_start: 'build',
  build_progress: 'build',
  socialize: 'visit',
  rest: 'idle',
};

/** Advance the shared village by exactly one tick. */
export function step({ world }: TickInput): TickResult {
  const tick = (BigInt(world.tick) + 1n).toString();
  const ledger: LedgerEntry[] = [];
  const changes: PublicChange[] = [];
  const activities = new Map<AgentKey, TickActivity>();
  let actionCount = 0;

  const nextByKey = new Map<AgentKey, AgentState>();
  const intents = new Map<AgentKey, Intent>();
  for (const agent of [...world.agents].sort(byKey)) {
    const intent = decide(agent, tick, world.params.values);
    intents.set(agent.key, intent);
    const acted = act(agent, intent, tick, world.params.values);
    // Needs move with what the Chog did, and a hungry Chog eats from its own stores.
    const lived = liveNeeds(acted.agent, intent.kind, `tick:${tick}:${agent.key}`, isRestTick(agent, tick));
    // Once the Plaza Fountain stands, chatting there is more fun.
    const fountain = world.projects.fountain.completedTick !== null && intent.kind === 'socialize' && intent.placeId === 'plaza';
    const livedAgent = fountain ? { ...lived.agent, needs: { ...lived.agent.needs, fun: Math.min(NEED_MAX, lived.agent.needs.fun + FOUNTAIN_FUN) } } : lived.agent;
    const result = { ...acted, agent: livedAgent, ledger: [...acted.ledger, ...lived.ledger], changes: [...acted.changes, ...lived.changes] };
    nextByKey.set(agent.key, result.agent);
    ledger.push(...result.ledger);
    changes.push(...result.changes);
    if (result.acted) {
      actionCount += 1;
      activities.set(agent.key, { agentKey: agent.key, kind: ACTIVITY_KIND[intent.kind], location: result.agent.location });
    }
  }

  // Greetings resolve after everyone has moved, so arrival order inside a tick never matters.
  // Social residents greet whoever else is at the same meeting place.
  const residents = [...nextByKey.values()].sort(byKey);
  for (const greeter of residents) {
    const intent = intents.get(greeter.key);
    if (intent?.kind !== 'socialize') continue;
    const last = greeter.lastGreetingTick;
    if (last !== null && BigInt(tick) - BigInt(last) < BigInt(GREETING_COOLDOWN_TICKS)) continue;
    const others = residents.filter(
      (a) => a.key !== greeter.key && a.location.kind === 'place' && a.location.placeId === intent.placeId,
    );
    if (others.length === 0) continue;
    const other = others[Number(BigInt(tick) % BigInt(others.length))]!;
    nextByKey.set(greeter.key, { ...nextByKey.get(greeter.key)!, lastGreetingTick: tick });
    changes.push({ type: 'greeted', agentKey: greeter.key, otherKey: other.key });
    activities.set(greeter.key, { ...activities.get(greeter.key)!, kind: 'greet' });
  }

  // Citizens are played by people, so they come after the Chogs and never change what a Chog decides.
  const district = stepCitizens(world, tick, world.agents.map((a) => nextByKey.get(a.key)!));
  changes.push(...district.changes);
  ledger.push(...district.ledger);
  // Votes due this tick close after everyone has acted; what passes applies from the next tick.
  const decided = resolveProposals({ ...world, citizens: district.citizens, treasury: district.treasury }, tick);
  changes.push(...decided.changes);
  const accounts: AccountEntry[] = [...district.accounts, ...decided.accounts];

  const next: WorldState = {
    ...world,
    tick,
    agents: district.agents,
    citizens: district.citizens,
    treasury: decided.treasury,
    params: decided.params,
    projects: decided.projects,
    proposals: decided.proposals,
  };
  return {
    world: next,
    ledger,
    accounts,
    changes,
    activities: [...activities.keys()].sort().map((k) => activities.get(k)!),
    actionCount,
    resultHash: hashWorld(next),
  };
}

/** Holder settings. An identical policy is a no-op; any effective change bumps the version and cancels work. */
export function applyPolicyChange(
  world: WorldState,
  key: AgentKey,
  nextPolicy: Pick<Policy, 'active' | 'focus' | 'homeStyle'>,
): TickResult {
  const index = findAgent(world, key);
  const agent = world.agents[index]!;
  const { policy } = agent;
  if (policy.active === nextPolicy.active && policy.focus === nextPolicy.focus && policy.homeStyle === nextPolicy.homeStyle) {
    return noChange(world);
  }
  const version = (BigInt(policy.version) + 1n).toString();
  const cancelled = cancelConstruction(agent, `policy:${key}:${version}`, 'policy');
  const updated: AgentState = {
    ...agent,
    policy: { version, active: nextPolicy.active, focus: nextPolicy.focus, homeStyle: nextPolicy.homeStyle },
    construction: null,
    inventory: applyLedger(agent.inventory, cancelled.ledger),
  };
  const next = replaceAgent(world, index, updated);
  return {
    world: next,
    ledger: cancelled.ledger,
    accounts: [],
    changes: [...cancelled.changes, { type: 'policy_changed', agentKey: key, policy: updated.policy }],
    activities: [],
    actionCount: 0,
    resultHash: hashWorld(next),
  };
}

/**
 * Reconcile one ownership observation. Unavailable freezes without erasing canonical state;
 * older generations are ignored; a repeated observation is idempotent; a new epoch or kind
 * (transfer, burn, remint) cancels work and pauses the resident. Nothing is ever granted.
 */
export function applyControlChange(world: WorldState, key: AgentKey, observation: ControlObservation): TickResult {
  const index = findAgent(world, key);
  const agent = world.agents[index]!;

  if (observation.status === 'unavailable') {
    if (agent.controlAvailability === 'unavailable') return noChange(world);
    const next = replaceAgent(world, index, { ...agent, controlAvailability: 'unavailable' });
    return {
      world: next,
      ledger: [],
      accounts: [],
      changes: [{ type: 'control_changed', agentKey: key, control: agent.control, availability: 'unavailable' }],
      activities: [],
    actionCount: 0,
      resultHash: hashWorld(next),
    };
  }

  const generation = BigInt(observation.projectionGeneration);
  const current = BigInt(agent.control.projectionGeneration);
  if (generation < current) return noChange(world);

  const control = {
    kind: observation.status,
    controller: observation.controller?.toLowerCase() ?? null,
    epoch: observation.epoch,
    projectionGeneration: observation.projectionGeneration,
    blockNumber: observation.blockNumber,
    blockHash: observation.blockHash,
    observedAtMs: observation.observedAtMs,
  };
  const sameControl =
    control.kind === agent.control.kind &&
    control.epoch === agent.control.epoch &&
    control.controller === (agent.control.controller?.toLowerCase() ?? null);

  if (sameControl) {
    if (generation === current && agent.controlAvailability === 'verified') return noChange(world);
    const next = replaceAgent(world, index, { ...agent, control, controlAvailability: 'verified' });
    return {
      world: next,
      ledger: [],
      accounts: [],
      changes: [{ type: 'control_changed', agentKey: key, control, availability: 'verified' }],
      activities: [],
    actionCount: 0,
      resultHash: hashWorld(next),
    };
  }

  const version = (BigInt(agent.policy.version) + 1n).toString();
  const cancelled = cancelConstruction(agent, `control:${key}:${control.epoch}:${control.projectionGeneration}`, 'control');
  const updated: AgentState = {
    ...agent,
    control,
    controlAvailability: 'verified',
    policy: { version, active: false, focus: 'builder', homeStyle: DEFAULT_HOME_STYLE },
    construction: null,
    inventory: applyLedger(agent.inventory, cancelled.ledger),
    // A job offer is the old holder's decision; coins and decorations stay with the Chog.
    offer: null,
  };
  const next = replaceAgent(world, index, updated);
  return {
    world: next,
    ledger: cancelled.ledger,
    accounts: [],
    changes: [
      ...cancelled.changes,
      { type: 'control_changed', agentKey: key, control, availability: 'verified' },
      { type: 'policy_changed', agentKey: key, policy: updated.policy },
    ],
    activities: [],
    actionCount: 0,
    resultHash: hashWorld(next),
  };
}
