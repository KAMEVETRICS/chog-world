import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import type { CityEvent } from '../../src/shared/contracts';
import { popsFor } from '../../src/web/world3d/Pops3D';
import { projectProgress } from '../../src/web/world3d/Projects3D';

const look = { Skin: 'Pink', Head: 'None', Body: 'None', Eyes: 'Normal' };

async function village() {
  const client = new FixtureCityClient({ autoStart: false });
  client.setActor('C');
  await client.joinCity({ name: 'Tester', look }, 'join');
  const me = (await client.getMyCitizen())!;
  return { client, me };
}

const after = (events: CityEvent[], revision: string) => events.filter((e) => BigInt(e.revision) > BigInt(revision));

describe('pops', () => {
  it('pays a villager a big coin pop for their own shift, and nothing for a stranger', async () => {
    const { client, me } = await village();
    await client.setJob({ expectedVersion: me.jobVersion, job: 'farmhand' }, 'job');
    const before = (await client.getSnapshot()).revision;
    client.tick();
    const snap = await client.getSnapshot();
    const tick = after(snap.recentEvents, before).find((e) => e.type === 'city_tick')!;

    const mine = popsFor(tick, snap.world, new Set([me.key]), null);
    expect(mine).toContainEqual(expect.objectContaining({ over: me.key, kind: 'coin', amount: 4, big: true }));

    const stranger = popsFor(tick, snap.world, new Set(), null);
    expect(stranger.some((p) => p.over === me.key)).toBe(false);
  });

  it('shows a Chog’s harvest to its holder and to whoever is watching it, not to everyone', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const before = (await client.getSnapshot()).revision;
    client.tick();
    const snap = await client.getSnapshot();
    const tick = after(snap.recentEvents, before).find((e) => e.type === 'city_tick')!;
    const gathered = tick.data.changes.find((c) => c.type === 'gathered')!;
    const key = (gathered as { agentKey: string }).agentKey;

    expect(popsFor(tick, snap.world, new Set([key]), null).some((p) => p.over === key && p.big)).toBe(true);
    expect(popsFor(tick, snap.world, new Set(), key).some((p) => p.over === key && !p.big)).toBe(true);
    expect(popsFor(tick, snap.world, new Set(), null).some((p) => p.over === key)).toBe(false);
  });

  it('always shows gifts to a project, at the project', async () => {
    const { client } = await village();
    const before = (await client.getSnapshot()).revision;
    await client.act({ type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 3 }, 'chip');
    const snap = await client.getSnapshot();
    const [event] = after(snap.recentEvents, before);
    expect(popsFor(event!, snap.world, new Set(), null)).toEqual([expect.objectContaining({ over: 'project:fountain', kind: 'coin', amount: 3 })]);
  });
});

describe('project progress', () => {
  it('counts the share of everything needed that has been given, capped per material', async () => {
    const { client } = await village();
    expect(projectProgress((await client.getSnapshot()).world, 'fountain')).toBe(0);
    await client.act({ type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 6 }, 'chip');
    // The Fountain needs 10 wood, 20 stone and 30 coins: 6 of 60.
    expect(projectProgress((await client.getSnapshot()).world, 'fountain')).toBeCloseTo(0.1);
  });
});
