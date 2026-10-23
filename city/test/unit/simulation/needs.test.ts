import { describe, expect, it } from 'vitest';
import type { AgentState, WorldState } from '../../../src/shared/contracts';
import { makeFixtureWorld, FIXTURE_ACTORS } from '../../../src/fixtures/residents';
import { FixtureCityClient } from '../../../src/fixtures/fixture-client';
import { step } from '../../../src/simulation/step';
import { decide } from '../../../src/simulation/policies';
import { applyDecor, liveNeeds, moodOf } from '../../../src/simulation/needs';
import { DECOR, EAT_GAIN, NEED_EFFECTS, NEED_START, REST_ENERGY_PER_LEVEL } from '../../../src/shared/rules';

const one = (patch: Partial<AgentState> = {}): AgentState => ({ ...makeFixtureWorld({ residentCount: 1 }).agents[0]!, ...patch });
const withAgent = (agent: AgentState): WorldState => ({ ...makeFixtureWorld({ residentCount: 1 }), agents: [agent] });

describe('needs', () => {
  it('start full-ish and move with what the Chog does; a house sleeps better than a tent', () => {
    const agent = one();
    expect(agent.needs).toEqual({ energy: NEED_START, hunger: NEED_START, fun: NEED_START, social: NEED_START });
    expect(liveNeeds(agent, 'gather', 'c').agent.needs).toEqual({ energy: 76, hunger: 77, fun: 79, social: 79 });
    expect(liveNeeds(agent, 'socialize', 'c').agent.needs).toMatchObject({ fun: 86, social: 95 });
    const tent = liveNeeds(one({ needs: { energy: 10, hunger: 80, fun: 50, social: 50 } }), 'rest', 'c').agent;
    const house = liveNeeds(one({ homeLevel: 2, needs: { energy: 10, hunger: 80, fun: 50, social: 50 } }), 'rest', 'c').agent;
    expect(tent.needs.energy).toBe(10 + NEED_EFFECTS.rest.energy);
    expect(house.needs.energy).toBe(10 + NEED_EFFECTS.rest.energy + 2 * REST_ENERGY_PER_LEVEL);
    // Paused, frozen and ruined Chogs are out of play.
    expect(liveNeeds(agent, 'idle', 'c').agent).toBe(agent);
  });

  it('a hungry Chog eats one food from its own stores while awake, never while asleep', () => {
    const hungry = one({ needs: { energy: 80, hunger: 30, fun: 80, social: 80 } });
    const awake = liveNeeds(hungry, 'gather', 'tick:9:x');
    expect(awake.agent.needs.hunger).toBe(30 + NEED_EFFECTS.work.hunger + EAT_GAIN);
    expect(awake.agent.inventory.food.total).toBe(hungry.inventory.food.total - 1);
    expect(awake.ledger).toEqual([expect.objectContaining({ resource: 'food', reason: 'eat', totalDelta: -1, reservedDelta: 0 })]);
    expect(awake.changes).toEqual([{ type: 'ate', agentKey: hungry.key }]);
    expect(liveNeeds(hungry, 'rest', 'c', true).agent.inventory).toEqual(hungry.inventory);
    // Lounging at home in the daytime (nothing to do) is not sleep: it still eats.
    expect(liveNeeds(hungry, 'rest', 'c', false).changes).toEqual([{ type: 'ate', agentKey: hungry.key }]);
    // Food reserved for a build is never eaten.
    const reserved = one({ needs: { energy: 80, hunger: 10, fun: 80, social: 80 }, inventory: { ...hungry.inventory, food: { total: 2, reserved: 2 } } });
    expect(liveNeeds(reserved, 'gather', 'c').ledger).toEqual([]);
  });

  it('urgent needs come before focus, but a build in progress is finished first', () => {
    const starving = one({ policy: { ...one().policy, focus: 'social' }, needs: { energy: 80, hunger: 20, fun: 80, social: 80 }, inventory: { ...one().inventory, food: { total: 0, reserved: 0 } } });
    expect(decide(starving, '2')).toEqual({ kind: 'gather', placeId: 'farm' });
    const bored = one({ needs: { energy: 80, hunger: 80, fun: 10, social: 80 } });
    expect(decide(bored, '2')).toMatchObject({ kind: 'socialize' });
    // Out for company, it stays until social and fun are back to SOCIAL_ENOUGH, then goes back to work.
    const out = one({ location: { kind: 'place', placeId: 'plaza' }, needs: { energy: 80, hunger: 80, fun: 70, social: 50 } });
    expect(decide(out, '2')).toMatchObject({ kind: 'socialize' });
    expect(decide({ ...out, needs: { ...out.needs, social: 70 } }, '2')).not.toMatchObject({ kind: 'socialize' });
    const tired = one({ needs: { energy: 10, hunger: 80, fun: 80, social: 80 } });
    expect(decide(tired, '2')).toEqual({ kind: 'rest' });
    const lonely = one({ needs: { energy: 80, hunger: 80, fun: 80, social: 10 } });
    expect(decide(lonely, '2')).toMatchObject({ kind: 'socialize' });
    const building = one({ needs: { energy: 10, hunger: 80, fun: 80, social: 10 }, construction: { actionId: 'a', targetLevel: 1, costs: { wood: 6, stone: 4, food: 2 }, remainingTicks: 1, policyVersion: '1', ownershipEpoch: '1', startedTick: '1' } });
    expect(decide(building, '2')).toEqual({ kind: 'build_progress' });
  });

  it('stay within 0-100 over two village days', () => {
    let world = makeFixtureWorld();
    for (let i = 0; i < 72; i += 1) world = step({ world }).world;
    for (const agent of world.agents) {
      for (const value of Object.values(agent.needs)) expect(value).toBeGreaterThanOrEqual(0);
      for (const value of Object.values(agent.needs)) expect(value).toBeLessThanOrEqual(100);
    }
  });
});

describe('mood', () => {
  it('is named by the lowest need when it is low, brightened by decorations', () => {
    expect(moodOf({ needs: { energy: 90, hunger: 90, fun: 90, social: 90 }, decor: [] }).kind).toBe('cheerful');
    expect(moodOf({ needs: { energy: 60, hunger: 60, fun: 60, social: 60 }, decor: [] }).kind).toBe('content');
    expect(moodOf({ needs: { energy: 20, hunger: 80, fun: 80, social: 80 }, decor: [] }).kind).toBe('tired');
    expect(moodOf({ needs: { energy: 80, hunger: 80, fun: 10, social: 80 }, decor: [] }).kind).toBe('bored');
    expect(moodOf({ needs: { energy: 10, hunger: 10, fun: 10, social: 10 }, decor: [] }).kind).toBe('miserable');
    expect(moodOf({ needs: { energy: 66, hunger: 66, fun: 66, social: 66 }, decor: ['lantern', 'bench'] })).toEqual({ kind: 'cheerful', score: 72 });
  });
});

describe('decorating a home', () => {
  it('costs the decoration from available stores, once per item, up to four', () => {
    const agent = one({ inventory: { wood: { total: 10, reserved: 6 }, stone: { total: 6, reserved: 0 }, food: { total: 5, reserved: 0 } } });
    const bought = applyDecor(withAgent(agent), agent.key, 'bench', 'decor:x:bench');
    expect(bought.ok).toBe(true);
    if (!bought.ok) return;
    const after = bought.world.agents[0]!;
    expect(after.decor).toEqual(['bench']);
    expect(after.inventory).toEqual({ wood: { total: 7, reserved: 6 }, stone: { total: 5, reserved: 0 }, food: { total: 5, reserved: 0 } });
    expect(bought.ledger.map((l) => [l.resource, l.totalDelta, l.reason])).toEqual([['wood', -3, 'decor'], ['stone', -1, 'decor']]);
    expect(applyDecor(bought.world, agent.key, 'bench', 'c')).toEqual({ ok: false, code: 'ALREADY_OWNED' });
    // Wood reserved for a build can't pay for a lantern: only 1 of 7 is free now.
    expect(applyDecor(bought.world, agent.key, 'lantern', 'c')).toEqual({ ok: false, code: 'CANT_AFFORD' });
    const full = one({ decor: ['lantern', 'flowerbed', 'bench', 'well'] });
    expect(applyDecor(withAgent(full), full.key, 'lantern', 'c')).toEqual({ ok: false, code: 'ALREADY_OWNED' });
    const four = one({ decor: ['flowerbed', 'bench', 'well', 'flowerbed'].slice(0, 3).concat('flowerbed') as AgentState['decor'] });
    expect(DECOR.lantern.costs.wood).toBe(2);
    expect(applyDecor(withAgent({ ...four, decor: ['flowerbed', 'bench', 'well', 'well'] }), four.key, 'lantern', 'c')).toEqual({ ok: false, code: 'DECOR_FULL' });
  });

  it('is a holder action in the fixture client, with the same fences as settings', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const mossy = (await client.getSnapshot()).world.agents[0]!;
    expect(mossy.control.controller).toBe(FIXTURE_ACTORS.A.address);
    client.setActor('B');
    expect(await client.decorate(mossy.key, { expectedEpoch: '1', item: 'lantern' }, 'k1')).toEqual({ ok: false, code: 'NOT_CONTROLLER' });
    client.setActor('A');
    expect(await client.decorate(mossy.key, { expectedEpoch: '9', item: 'lantern' }, 'k2')).toEqual({ ok: false, code: 'CONTROL_CHANGED' });
    const done = await client.decorate(mossy.key, { expectedEpoch: '1', item: 'lantern' }, 'k3');
    expect(done).toMatchObject({ ok: true, agent: { decor: ['lantern'], inventory: { wood: { total: mossy.inventory.wood.total - 2 } } } });
    expect(await client.decorate(mossy.key, { expectedEpoch: '1', item: 'lantern' }, 'k3')).toEqual(done);
    expect(await client.decorate(mossy.key, { expectedEpoch: '1', item: 'well' }, 'k3')).toEqual({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const events = (await client.getSnapshot()).recentEvents.filter((e) => e.type === 'home_decorated');
    expect(events.map((e) => e.data.changes)).toEqual([[{ type: 'decorated', agentKey: mossy.key, item: 'lantern' }]]);
  });
});
