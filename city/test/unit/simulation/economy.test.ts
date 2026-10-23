import { describe, expect, it } from 'vitest';
import type { AgentState, LedgerEntry, WorldState } from '../../../src/shared/contracts';
import { makeFixtureWorld } from '../../../src/fixtures/residents';
import { step } from '../../../src/simulation/step';
import { applyLedger } from '../../../src/simulation/resources';
import { RESOURCE_CAP } from '../../../src/shared/rules';

const amounts = (a: AgentState) => [a.inventory.wood.total, a.inventory.stone.total, a.inventory.food.total];
const reserved = (a: AgentState) => [a.inventory.wood.reserved, a.inventory.stone.reserved, a.inventory.food.reserved];

function run(world: WorldState, ticks: number) {
  const results = [];
  let current = world;
  for (let i = 0; i < ticks; i += 1) {
    const result = step({ world: current });
    results.push(result);
    current = result.world;
  }
  return results;
}

describe('first home from the exact admission grant', () => {
  const world = makeFixtureWorld({ residentCount: 1 });
  const frozen = structuredClone(world);
  const [t1, t2, t3, t4, t5] = run(world, 5).map((r) => r!);

  it('tick 1 gathers wood at the forest', () => {
    const a = t1!.world.agents[0]!;
    expect(t1!.world.tick).toBe('1');
    expect(amounts(a)).toEqual([7, 2, 3]);
    expect(a.location).toEqual({ kind: 'place', placeId: 'forest' });
  });

  it('tick 2 gathers stone at the quarry', () => {
    const a = t2!.world.agents[0]!;
    expect(amounts(a)).toEqual([7, 4, 2]);
    expect(a.location).toEqual({ kind: 'place', placeId: 'quarry' });
  });

  it('tick 3 returns home and reserves the level-1 recipe', () => {
    const a = t3!.world.agents[0]!;
    expect(amounts(a)).toEqual([7, 4, 2]);
    expect(reserved(a)).toEqual([6, 4, 2]);
    expect(a.location).toEqual({ kind: 'plot', plotId: 'p01' });
    expect(a.construction).toMatchObject({ targetLevel: 1, remainingTicks: 2, startedTick: '3' });
  });

  it('tick 4 leaves one eligible tick', () => {
    expect(t4!.world.agents[0]!.construction?.remainingTicks).toBe(1);
    expect(t4!.ledger).toEqual([]);
  });

  it('tick 5 completes level 1 and consumes the reservation', () => {
    const a = t5!.world.agents[0]!;
    expect(a.homeLevel).toBe(1);
    expect(a.construction).toBeNull();
    expect(amounts(a)).toEqual([1, 0, 0]);
    expect(reserved(a)).toEqual([0, 0, 0]);
    expect(t5!.changes).toContainEqual(expect.objectContaining({ type: 'build_completed', level: 1 }));
  });

  it('each tick is one action with typed ledger lines', () => {
    expect([t1, t2, t3, t4, t5].map((r) => r!.actionCount)).toEqual([1, 1, 1, 1, 1]);
    expect(t1!.ledger.map((l) => [l.resource, l.reason, l.totalDelta, l.reservedDelta])).toEqual([
      ['food', 'gather_input', -1, 0],
      ['wood', 'gather_output', 3, 0],
    ]);
    expect(t3!.ledger.every((l) => l.reason === 'build_reserve' && l.totalDelta === 0)).toBe(true);
    expect(t5!.ledger.map((l) => [l.reason, l.totalDelta, l.reservedDelta])).toEqual([
      ['build_consume', -6, -6],
      ['build_consume', -4, -4],
      ['build_consume', -2, -2],
    ]);
  });

  it('replaying the ledger over the admission grant reproduces inventory', () => {
    const lines: LedgerEntry[] = [t1, t2, t3, t4, t5].flatMap((r) => r!.ledger);
    expect(new Set(lines.map((l) => `${l.causeId}/${l.lineId}`)).size).toBe(lines.length);
    expect(applyLedger(world.agents[0]!.inventory, lines)).toEqual(t5!.world.agents[0]!.inventory);
  });

  it('never mutates its input', () => {
    expect(world).toEqual(frozen);
  });
});

describe('invariants over long runs', () => {
  it('1,000 ticks keep 0 <= reserved <= total <= cap for every resident', () => {
    let world = makeFixtureWorld();
    for (let i = 0; i < 1000; i += 1) {
      world = step({ world }).world;
      for (const agent of world.agents) {
        for (const line of Object.values(agent.inventory)) {
          expect(line.reserved).toBeGreaterThanOrEqual(0);
          expect(line.reserved).toBeLessThanOrEqual(line.total);
          expect(line.total).toBeLessThanOrEqual(RESOURCE_CAP);
        }
      }
    }
    expect(world.tick).toBe('1000');
    // The world now carries citizens, the treasury and projects too, so give the long run more time.
  }, 20_000);

  it('a gatherer with capped wood does not burn food at the forest', () => {
    const world = makeFixtureWorld({ residentCount: 4 });
    const gatherer = world.agents[3]!;
    expect(gatherer.policy.focus).toBe('gatherer');
    gatherer.inventory.wood.total = RESOURCE_CAP;
    gatherer.inventory.stone.total = RESOURCE_CAP;
    gatherer.inventory.food.total = 1;
    const next = step({ world }).world.agents[3]!;
    expect(next.location).toEqual({ kind: 'place', placeId: 'farm' });
    expect(next.inventory.wood.total).toBe(RESOURCE_CAP);
    expect(next.inventory.food.total).toBe(4);
  });
});
