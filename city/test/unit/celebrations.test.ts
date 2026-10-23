import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import type { CityEvent } from '../../src/shared/contracts';
import { celebrationsFor } from '../../src/web/fx/celebrations';

const after = (events: CityEvent[], revision: string) => events.filter((e) => BigInt(e.revision) > BigInt(revision));

describe('celebrations', () => {
  it('a holder gets a banner, a big burst and the level-up jingle for their own new home; a stranger only sees the burst', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const start = (await client.getSnapshot()).revision;
    for (let i = 0; i < 8; i += 1) client.tick();
    const snap = await client.getSnapshot();
    const built = after(snap.recentEvents, start).find((e) => e.data.changes.some((c) => c.type === 'build_completed'))!;
    const change = built.data.changes.find((c) => c.type === 'build_completed') as { agentKey: string; level: number };
    const owner = snap.world.agents.find((a) => a.key === change.agentKey)!;
    const holder = new Set(snap.world.agents.filter((a) => a.control.controller === owner.control.controller).map((a) => a.key));

    const yours = celebrationsFor(built, snap.world, holder).find((c) => c.burst?.at.kind === 'plot' && c.burst.at.plotId === owner.plotId)!;
    expect(yours.banner?.title).toMatch(new RegExp(`^${owner.name} finished a `));
    expect(yours.burst?.big).toBe(true);
    expect(yours.cue).toBe('levelUp');

    const theirs = celebrationsFor(built, snap.world, new Set()).find((c) => c.burst?.at.kind === 'plot' && c.burst.at.plotId === owner.plotId)!;
    expect(theirs.banner).toBeNull();
    expect(theirs.burst?.big).toBe(false);
    expect(theirs.cue).toBeNull();
  });

  it('names a new title when a home level earns one', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const start = (await client.getSnapshot()).revision;
    for (let i = 0; i < 8; i += 1) client.tick();
    const snap = await client.getSnapshot();
    const mossy = snap.world.agents.find((a) => a.name === 'Mossy')!;
    const event = after(snap.recentEvents, start).find((e) => e.data.changes.some((c) => c.type === 'build_completed' && c.agentKey === mossy.key))!;
    const moment = celebrationsFor(event, snap.world, new Set([mossy.key])).find((c) => c.banner)!;
    expect(moment.banner).toMatchObject({ kind: 'title', detail: 'Level 1, and Mossy is now a Settler.' });
  });

  it('chimes a coin when your villager is paid, and celebrates a finished project for everyone', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    client.setActor('C');
    await client.joinCity({ name: 'Tester', look: { Skin: 'Pink', Head: 'None', Body: 'None', Eyes: 'Normal' } }, 'join');
    const me = (await client.getMyCitizen())!;
    await client.setJob({ expectedVersion: me.jobVersion, job: 'farmhand' }, 'job');
    const start = (await client.getSnapshot()).revision;
    client.tick();
    const snap = await client.getSnapshot();
    const paid = after(snap.recentEvents, start).find((e) => e.type === 'city_tick')!;
    expect(celebrationsFor(paid, snap.world, new Set([me.key])).some((c) => c.cue === 'coin')).toBe(true);

    // A finished project is everyone's moment, holder or not.
    const world = snap.world;
    const done = { ...world, projects: { ...world.projects, fountain: { ...world.projects.fountain, completedTick: world.tick } } };
    const event: CityEvent = { revision: '999', type: 'city_action', data: { tick: world.tick, changes: [{ type: 'project_completed', projectId: 'fountain' }] }, createdAt: '' };
    expect(celebrationsFor(event, done, new Set())[0]).toMatchObject({
      banner: { kind: 'project', title: 'The Plaza Fountain is built!' },
      burst: { at: { kind: 'project', id: 'fountain' }, big: true },
      cue: 'fanfare',
    });
  });
});
