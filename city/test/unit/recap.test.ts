import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import { FIXTURE_ACTORS } from '../../src/fixtures/residents';
import type { WorldState } from '../../src/shared/contracts';
import { capture, recapOf, RECAP_AFTER_TICKS } from '../../src/web/recap/recap';
import { imageSources } from '../../src/fixtures/chog-genesis';

const holderA = (w: WorldState) => w.agents.filter((a) => a.control.controller === FIXTURE_ACTORS.A.address);

describe('while you were away', () => {
  it('says nothing after a glance away', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const before = (await client.getSnapshot()).world;
    const seen = capture(before, holderA(before), null);
    for (let i = 0; i < RECAP_AFTER_TICKS - 1; i += 1) client.tick();
    const now = (await client.getSnapshot()).world;
    expect(recapOf(seen, now, holderA(now), null)).toBeNull();
  });

  it('tells a holder what their Chogs built while they were gone, and how long it was', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const before = (await client.getSnapshot()).world;
    const seen = capture(before, holderA(before), null);
    client.skipDay();
    const now = (await client.getSnapshot()).world;
    const recap = recapOf(seen, now, holderA(now), null)!;
    expect(recap.days).toBe(1);
    const mossy = recap.chogs.find((c) => c.name === 'Mossy')!;
    expect(mossy.lines).toContain('Finished a cottage (level 1).');
  });

  it('reports a sale, town news and a villager who can now vote', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    client.setActor('C');
    await client.joinCity({ name: 'Tester', look: { Skin: 'Pink', Head: 'None', Body: 'None', Eyes: 'Normal' } }, 'join');
    const me = (await client.getMyCitizen())!;
    await client.setJob({ expectedVersion: me.jobVersion, job: 'farmhand' }, 'job');
    const before = (await client.getSnapshot()).world;
    const mossy = before.agents[0]!;
    // Pretend Villager C also held Mossy when they left.
    const seen = capture(before, [mossy], before.citizens.find((c) => c.key === me.key)!);
    await client.act({ type: 'contribute', projectId: 'fountain', from: { kind: 'citizen' }, asset: 'coins', amount: 5 }, 'chip');
    for (let d = 0; d < 3; d += 1) client.skipDay();
    const now = (await client.getSnapshot()).world;
    const recap = recapOf(seen, now, [], now.citizens.find((c) => c.key === me.key)!)!;
    expect(recap.chogs).toEqual([expect.objectContaining({ name: 'Mossy', lines: ['Changed hands. It now belongs to its new holder.'] })]);
    expect(recap.villager).toContain('You can vote now. Your voice counts at the next proposal.');
    expect(recap.villager.some((l) => l.startsWith('Earned'))).toBe(true);
    expect(recap.town.some((l) => l.startsWith('The Plaza Fountain is'))).toBe(true);
  });
});

describe('NFT images', () => {
  it('offers the same image on every gateway, the given one first', () => {
    const sources = imageSources('https://gateway.pinata.cloud/ipfs/cid/12.webp');
    expect(sources[0]).toBe('https://gateway.pinata.cloud/ipfs/cid/12.webp');
    expect(sources.length).toBeGreaterThan(1);
    expect(sources.every((s) => s.endsWith('/ipfs/cid/12.webp'))).toBe(true);
  });
});
