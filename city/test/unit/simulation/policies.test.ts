import { describe, expect, it } from 'vitest';
import type { WorldState } from '../../../src/shared/contracts';
import { makeFixtureWorld } from '../../../src/fixtures/residents';
import { isRestTick, socialPlace, temperament } from '../../../src/simulation/policies';
import { step } from '../../../src/simulation/step';
import { GREETING_COOLDOWN_TICKS } from '../../../src/shared/rules';

function advance(world: WorldState, ticks: number): WorldState {
  let current = world;
  for (let i = 0; i < ticks; i += 1) current = step({ world: current }).world;
  return current;
}

describe('focus policies', () => {
  it('a gatherer stockpiles and never starts construction', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    world.agents[0]!.policy.focus = 'gatherer';
    let current = world;
    for (let i = 0; i < 40; i += 1) {
      const result = step({ world: current });
      expect(result.changes.some((c) => c.type === 'build_started')).toBe(false);
      current = result.world;
    }
    const inv = current.agents[0]!.inventory;
    expect(inv.wood.total + inv.stone.total + inv.food.total).toBeGreaterThan(10);
    expect(current.agents[0]!.homeLevel).toBe(0);
  });

  it('a gatherer picks the lowest stock, breaking ties wood > stone > food', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    const agent = world.agents[0]!;
    agent.policy.focus = 'gatherer';
    agent.inventory.wood.total = 5;
    agent.inventory.stone.total = 5;
    agent.inventory.food.total = 5;
    expect(step({ world }).world.agents[0]!.location).toEqual({ kind: 'place', placeId: 'forest' });
    agent.inventory.wood.total = 6;
    expect(step({ world }).world.agents[0]!.location).toEqual({ kind: 'place', placeId: 'quarry' });
  });

  it('a builder short on food for the next gather goes to the farm first', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    world.agents[0]!.inventory.food.total = 2;
    const next = step({ world }).world.agents[0]!;
    expect(next.location).toEqual({ kind: 'place', placeId: 'farm' });
    expect(next.inventory.food.total).toBe(5);
  });

  it('social residents gather at the plaza and greet with a cooldown', () => {
    const world = makeFixtureWorld({ residentCount: 2 });
    world.agents[0]!.policy.focus = 'social';
    world.agents[1]!.policy.focus = 'social';
    const greetTicks: number[] = [];
    let current = world;
    for (let i = 0; i < 14; i += 1) {
      const result = step({ world: current });
      current = result.world;
      if (result.changes.some((c) => c.type === 'greeted' && c.agentKey === world.agents[0]!.key)) {
        greetTicks.push(Number(current.tick));
      }
    }
    expect(current.agents[0]!.location).toEqual({ kind: 'place', placeId: 'plaza' });
    expect(greetTicks).toEqual([1, 1 + GREETING_COOLDOWN_TICKS, 1 + 2 * GREETING_COOLDOWN_TICKS]);
    const inv = current.agents[0]!.inventory;
    expect([inv.wood.total, inv.stone.total, inv.food.total]).toEqual([4, 2, 4]);
  });

  it('social residents move together between the plaza, tavern and workshop, greeting at each', () => {
    const world = makeFixtureWorld({ residentCount: 2 });
    for (const agent of world.agents) agent.policy.focus = 'social';
    const where = (w: WorldState) => (w.agents[0]!.location as { placeId: string }).placeId;
    const greetedAt: string[] = [];
    let current = world;
    for (let i = 0; i < 12; i += 1) {
      const result = step({ world: current });
      current = result.world;
      expect(where(current)).toBe(where({ ...current, agents: [current.agents[1]!] }));
      if (result.changes.some((c) => c.type === 'greeted')) greetedAt.push(where(current));
    }
    expect(socialPlace('3')).toBe('plaza');
    expect(socialPlace('4')).toBe('tavern');
    expect(socialPlace('8')).toBe('workshop');
    expect(socialPlace('12')).toBe('plaza');
    expect(new Set(greetedAt)).toEqual(new Set(['plaza', 'tavern']));
  });

  it('reports one activity per acting resident; greets replace visits; paused residents are left out', () => {
    const world = makeFixtureWorld({ residentCount: 4 });
    world.agents[0]!.policy.focus = 'social';
    world.agents[1]!.policy.focus = 'social';
    world.agents[3]!.policy.active = false;
    const result = step({ world });
    const byKey = Object.fromEntries(result.activities.map((a) => [a.agentKey, a]));
    expect(result.activities).toHaveLength(3);
    expect(byKey[world.agents[3]!.key]).toBeUndefined();
    expect(byKey[world.agents[0]!.key]).toEqual({ agentKey: world.agents[0]!.key, kind: 'greet', location: { kind: 'place', placeId: 'plaza' } });
    expect(byKey[world.agents[2]!.key]!.kind).toBe('gather');
    expect(result.activities.map((a) => a.agentKey)).toEqual([...result.activities.map((a) => a.agentKey)].sort());

    // Asleep at home reports as idle at the plot.
    const night = advance(makeFixtureWorld({ residentCount: 1 }), 15);
    const asleep = step({ world: night }).activities[0]!;
    expect(asleep).toMatchObject({ kind: 'idle', location: { kind: 'plot' } });
  });

  it('a lone social resident waits at the plaza without greeting anyone', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    world.agents[0]!.policy.focus = 'social';
    const result = step({ world });
    expect(result.changes.some((c) => c.type === 'greeted')).toBe(false);
    expect(result.world.agents[0]!.lastGreetingTick).toBeNull();
  });

  it('paused and unavailable residents make no productive progress', () => {
    const world = makeFixtureWorld({ residentCount: 2 });
    world.agents[0]!.policy.active = false;
    world.agents[1]!.controlAvailability = 'unavailable';
    const after = advance(world, 10);
    expect(after.agents[0]!.inventory).toEqual(world.agents[0]!.inventory);
    expect(after.agents[1]!.inventory).toEqual(world.agents[1]!.inventory);
    expect(after.agents[0]!.location).toEqual(world.agents[0]!.location);
  });

  it('residents sleep in their own home at night, with staggered bedtimes, and make no progress', () => {
    // Tick 15 is hour 19 (dusk): token 0 goes to bed first, token 1 a tick later.
    const before = advance(makeFixtureWorld({ residentCount: 2 }), 14);
    const first = step({ world: before }).world;
    expect(isRestTick(first.agents[0]!, '15')).toBe(true);
    expect(isRestTick(first.agents[1]!, '15')).toBe(false);
    expect(first.agents[0]!.location).toEqual({ kind: 'plot', plotId: first.agents[0]!.plotId });

    let current = first;
    for (let tick = 16; tick <= 29; tick += 1) {
      const next = step({ world: current }).world;
      next.agents.forEach((agent, i) => {
        expect(isRestTick(agent, String(tick))).toBe(true);
        expect(agent.location).toEqual({ kind: 'plot', plotId: agent.plotId });
        expect(agent.inventory).toEqual(current.agents[i]!.inventory);
        expect(agent.construction).toEqual(current.agents[i]!.construction);
      });
      current = next;
    }
    // Hour 34 is dawn: everyone is up.
    expect(current.agents.some((a) => isRestTick(a, '30'))).toBe(false);
  });

  it('agent order does not change outcomes', () => {
    const world = makeFixtureWorld();
    const reversed = { ...world, agents: [...world.agents].reverse() };
    const a = advance(world, 30);
    const b = advance(reversed, 30);
    const byKey = (w: WorldState) => Object.fromEntries(w.agents.map((x) => [x.key, x]));
    expect(byKey(b)).toEqual(byKey(a));
  });
});

describe('temperament', () => {
  it('is fixed by token ID: the same Chog always has the same habits', () => {
    const [a] = makeFixtureWorld({ residentCount: 1 }).agents;
    expect(temperament(a!)).toEqual(temperament({ identity: { ...a!.identity } }));
  });

  it('breaks the herd: on the first morning the builders head to more than one site', () => {
    const world = makeFixtureWorld();
    for (const agent of world.agents) agent.policy.focus = 'builder';
    const sites = new Set<string>();
    let current = world;
    for (let i = 0; i < 3; i += 1) {
      current = step({ world: current }).world;
      const here = current.agents.filter((a) => a.location.kind === 'place').map((a) => (a.location as { placeId: string }).placeId);
      if (new Set(here).size > 1) here.forEach((s) => sites.add(s));
    }
    expect(sites.size).toBeGreaterThan(1);
  });

  it('staggers the social round, yet friends still share most of each stop', () => {
    const phases = [0, 1, 2, 3];
    for (const phase of phases) expect(socialPlace('0', phase)).toBe('plaza');
    // A resident a tick out of phase moves on a tick earlier, and is with the others the rest of the stay.
    const together = Array.from({ length: 12 }, (_, t) => socialPlace(String(t), 0) === socialPlace(String(t), 1)).filter(Boolean).length;
    expect(together).toBe(9);
  });
});
