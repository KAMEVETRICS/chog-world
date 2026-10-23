import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import { FIXTURE_ACTORS } from '../../src/fixtures/residents';
import type { CitizenState, WorldState } from '../../src/shared/contracts';
import { goalsFor, type GoalInput } from '../../src/web/guide/goals';

const none = new Set<never>();

async function state(actor: 'A' | 'C' | null) {
  const client = new FixtureCityClient({ autoStart: false });
  client.setActor(actor);
  const snapshot = await client.getSnapshot();
  return { client, snapshot, chogs: await client.getMyAgents() };
}

const input = (world: WorldState, extra: Partial<GoalInput> = {}): GoalInput => ({
  world,
  events: [],
  citizen: null,
  chogs: [],
  signedIn: false,
  seen: none,
  doneBefore: none,
  ...extra,
});

describe('goals', () => {
  it('gives a visitor first steps, finished by meeting a Chog and reading the log', async () => {
    const { snapshot } = await state(null);
    const fresh = goalsFor(input(snapshot.world));
    expect(fresh.scope).toBe('first');
    expect(fresh.goals.map((g) => g.id)).toEqual(['meet', 'log', 'join']);
    expect(fresh.goals.every((g) => !g.done)).toBe(true);

    const later = goalsFor(input(snapshot.world, { seen: new Set(['met', 'log']) }));
    expect(later.goals.filter((g) => g.done).map((g) => g.id)).toEqual(['meet', 'log']);
  });

  it('gives a new villager a shift, a project and a gift, and ticks off the shift once worked', async () => {
    const { client } = await state('C');
    await client.joinCity({ name: 'Tester', look: { Skin: 'Pink', Head: 'None', Body: 'None', Eyes: 'Normal' } }, 'join');
    let me = (await client.getMyCitizen())!;
    await client.setJob({ expectedVersion: me.jobVersion, job: 'farmhand' }, 'job');
    let snap = await client.getSnapshot();
    const before = goalsFor(input(snap.world, { citizen: me, signedIn: true, events: snap.recentEvents }));
    expect(before.scope).toBe(0);
    expect(before.goals.map((g) => g.id)).toEqual(['work', 'chip', 'gift']);
    expect(before.goals[0]!.progress).toMatchObject({ value: 0, max: 3 });

    client.tick();
    snap = await client.getSnapshot();
    me = (await client.getMyCitizen())!;
    const after = goalsFor(input(snap.world, { citizen: me, signedIn: true, events: snap.recentEvents }));
    expect(after.goals.find((g) => g.id === 'work')!.done).toBe(true);
  });

  it('counts a gift and a contribution from today only', async () => {
    const { client } = await state('C');
    await client.joinCity({ name: 'Tester', look: { Skin: 'Pink', Head: 'None', Body: 'None', Eyes: 'Normal' } }, 'join');
    await client.act({ type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 1 }, 'chip');
    const mossy = (await client.getSnapshot()).world.agents[0]!;
    await client.act({ type: 'gift', from: { kind: 'citizen' }, to: mossy.key, asset: 'coins', amount: 1 }, 'gift');
    const snap = await client.getSnapshot();
    const me = (await client.getMyCitizen()) as CitizenState;
    const today = goalsFor(input(snap.world, { citizen: me, signedIn: true, events: snap.recentEvents }));
    expect(today.goals.filter((g) => g.done).map((g) => g.id)).toEqual(['chip', 'gift']);

    client.skipDay();
    const next = await client.getSnapshot();
    const tomorrow = goalsFor(input(next.world, { citizen: (await client.getMyCitizen())!, signedIn: true, events: next.recentEvents }));
    expect(tomorrow.scope).toBe(today.scope === 'first' ? 1 : today.scope + 1);
    expect(tomorrow.goals.find((g) => g.id === 'chip')!.done).toBe(false);
  });

  it('gives a holder a check-in and a market trade, and points them at their own Chog', async () => {
    const { snapshot, chogs } = await state('A');
    const list = goalsFor(input(snapshot.world, { chogs, signedIn: true }));
    expect(list.goals.map((g) => g.id)).toEqual(['checkin', 'trade', 'chip']);
    expect(list.goals[0]).toMatchObject({ title: `Check on your Chogs`, target: { kind: 'chog', key: chogs[0]!.key } });
    expect(chogs.every((c) => c.control.controller === FIXTURE_ACTORS.A.address)).toBe(true);
  });

  it('keeps a goal finished once it was finished today', async () => {
    const { snapshot } = await state(null);
    const list = goalsFor(input(snapshot.world, { doneBefore: new Set(['log']) }));
    expect(list.goals.find((g) => g.id === 'log')!.done).toBe(true);
  });
});
