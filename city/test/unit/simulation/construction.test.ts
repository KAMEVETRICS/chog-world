import { describe, expect, it } from 'vitest';
import type { ControlObservation, WorldState } from '../../../src/shared/contracts';
import { FIXTURE_ACTORS, makeFixtureWorld } from '../../../src/fixtures/residents';
import { applyControlChange, applyPolicyChange, step } from '../../../src/simulation/step';

/** One builder after tick 3: level-1 construction holds a 6/4/2 reservation. */
function midConstruction(): WorldState {
  let world = makeFixtureWorld({ residentCount: 1 });
  for (let i = 0; i < 3; i += 1) world = step({ world }).world;
  expect(world.agents[0]!.construction).not.toBeNull();
  return world;
}

const controlled = (
  controller: string,
  epoch: string,
  generation: string,
): Exclude<ControlObservation, { status: 'unavailable' }> => ({
  status: 'controlled',
  controller,
  epoch,
  projectionGeneration: generation,
  blockNumber: '100',
  blockHash: '0xabc',
  observedAtMs: 1,
});

describe('policy changes', () => {
  it('an identical policy is a no-op', () => {
    const world = midConstruction();
    const agent = world.agents[0]!;
    const result = applyPolicyChange(world, agent.key, {
      active: agent.policy.active,
      focus: agent.policy.focus,
      homeStyle: agent.policy.homeStyle,
    });
    expect(result.world).toBe(world);
    expect(result.ledger).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it('pausing mid-construction releases the reservation exactly once', () => {
    const world = midConstruction();
    const key = world.agents[0]!.key;
    const result = applyPolicyChange(world, key, { active: false, focus: 'builder', homeStyle: 'cottage' });
    const agent = result.world.agents[0]!;
    expect(agent.construction).toBeNull();
    expect(agent.policy).toMatchObject({ version: '2', active: false });
    expect([agent.inventory.wood, agent.inventory.stone, agent.inventory.food]).toEqual([
      { total: 7, reserved: 0 },
      { total: 4, reserved: 0 },
      { total: 2, reserved: 0 },
    ]);
    expect(result.ledger.map((l) => [l.reason, l.totalDelta, l.reservedDelta])).toEqual([
      ['build_release', 0, -6],
      ['build_release', 0, -4],
      ['build_release', 0, -2],
    ]);
    expect(result.changes).toContainEqual(expect.objectContaining({ type: 'build_cancelled', cause: 'policy' }));

    // No later tick finishes the cancelled build.
    let later = result.world;
    for (let i = 0; i < 5; i += 1) later = step({ world: later }).world;
    expect(later.agents[0]!.homeLevel).toBe(0);
  });

  it('changing focus or style also cancels unfinished construction', () => {
    const world = midConstruction();
    const key = world.agents[0]!.key;
    const restyled = applyPolicyChange(world, key, { active: true, focus: 'builder', homeStyle: 'treehouse' });
    expect(restyled.world.agents[0]!.construction).toBeNull();
    expect(restyled.world.agents[0]!.inventory.wood.reserved).toBe(0);
  });

  it('an unknown key throws', () => {
    expect(() => applyPolicyChange(makeFixtureWorld(), 'nope', { active: true, focus: 'builder', homeStyle: 'cottage' })).toThrow();
  });
});

describe('control changes (transfer, burn, outage)', () => {
  it('A -> B keeps plot, home and totals; cancels work; pauses; grants nothing', () => {
    const world = midConstruction();
    const before = world.agents[0]!;
    const result = applyControlChange(world, before.key, controlled(FIXTURE_ACTORS.B.address, '2', '2'));
    const after = result.world.agents[0]!;
    expect(after.plotId).toBe(before.plotId);
    expect(after.homeLevel).toBe(before.homeLevel);
    expect([after.inventory.wood.total, after.inventory.stone.total, after.inventory.food.total]).toEqual([7, 4, 2]);
    expect(after.inventory.wood.reserved + after.inventory.stone.reserved + after.inventory.food.reserved).toBe(0);
    expect(after.construction).toBeNull();
    expect(after.policy).toMatchObject({ active: false, focus: 'builder', version: '2' });
    expect(after.control).toMatchObject({ controller: FIXTURE_ACTORS.B.address, epoch: '2' });
    expect(result.ledger.every((l) => l.reason === 'build_release')).toBe(true);
    expect(result.changes).toContainEqual(expect.objectContaining({ type: 'build_cancelled', cause: 'control' }));
  });

  it('A -> B -> A never revives the original active policy', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    const key = world.agents[0]!.key;
    const toB = applyControlChange(world, key, controlled(FIXTURE_ACTORS.B.address, '2', '2')).world;
    const backToA = applyControlChange(toB, key, controlled(FIXTURE_ACTORS.A.address, '3', '3')).world;
    expect(backToA.agents[0]!.policy.active).toBe(false);
    expect(backToA.agents[0]!.policy.version).toBe('3');
  });

  it('re-observing the same projection is idempotent', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    const key = world.agents[0]!.key;
    const once = applyControlChange(world, key, controlled(FIXTURE_ACTORS.B.address, '2', '2'));
    const twice = applyControlChange(once.world, key, controlled(FIXTURE_ACTORS.B.address, '2', '2'));
    expect(twice.world).toBe(once.world);
    expect(twice.ledger).toEqual([]);
  });

  it('an older projection generation cannot overwrite current control', () => {
    const world = makeFixtureWorld({ residentCount: 1 });
    const key = world.agents[0]!.key;
    const current = applyControlChange(world, key, controlled(FIXTURE_ACTORS.B.address, '2', '5')).world;
    const stale = applyControlChange(current, key, controlled(FIXTURE_ACTORS.A.address, '1', '4'));
    expect(stale.world).toBe(current);
  });

  it('burn leaves read-only ruins, releases once, and re-observing changes nothing', () => {
    const world = midConstruction();
    const key = world.agents[0]!.key;
    const burn: ControlObservation = { ...controlled(FIXTURE_ACTORS.A.address, '2', '2'), status: 'burned', controller: null };
    const burned = applyControlChange(world, key, burn);
    expect(burned.world.agents[0]!.control.kind).toBe('burned');
    expect(burned.ledger).toHaveLength(3);
    expect(applyControlChange(burned.world, key, burn).world).toBe(burned.world);

    let later = burned.world;
    for (let i = 0; i < 5; i += 1) later = step({ world: later }).world;
    expect(later.agents[0]!.inventory).toEqual(burned.world.agents[0]!.inventory);

    const reminted = applyControlChange(burned.world, key, controlled(FIXTURE_ACTORS.B.address, '3', '3')).world.agents[0]!;
    expect(reminted.control.kind).toBe('controlled');
    expect(reminted.policy.active).toBe(false);
    expect(reminted.plotId).toBe('p01');
    expect(reminted.inventory).toEqual(burned.world.agents[0]!.inventory);
  });

  it('unavailable freezes progress without erasing canonical control', () => {
    const world = midConstruction();
    const key = world.agents[0]!.key;
    const frozen = applyControlChange(world, key, { status: 'unavailable', reason: 'rpc timeout', observedAtMs: 1 }).world;
    expect(frozen.agents[0]!.controlAvailability).toBe('unavailable');
    expect(frozen.agents[0]!.control).toEqual(world.agents[0]!.control);
    const later = step({ world: frozen }).world.agents[0]!;
    expect(later.construction?.remainingTicks).toBe(world.agents[0]!.construction?.remainingTicks);

    const recovered = applyControlChange(frozen, key, {
      ...controlled(FIXTURE_ACTORS.A.address, '1', '1'),
    }).world.agents[0]!;
    expect(recovered.controlAvailability).toBe('verified');
    expect(recovered.construction).not.toBeNull();
  });
});
