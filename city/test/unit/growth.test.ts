import { describe, expect, it } from 'vitest';
import { FixtureCityClient } from '../../src/fixtures/fixture-client';
import { builtUp, SPARE_LOTS, SPARE_PLOTS } from '../../src/web/world/growth';
import { DISTRICTS, PLOTS } from '../../src/web/world3d/layout';

describe('a town that grows as people arrive', () => {
  it('starts small: homes in use plus a couple of free ones at the edge, nothing beyond', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const world = (await client.getSnapshot()).world;
    const built = builtUp(world);
    expect(built.plots.size).toBe(world.agents.length + SPARE_PLOTS);
    expect(built.lots.size).toBe(world.citizens.length + SPARE_LOTS);
    // No district island is needed yet.
    expect(DISTRICTS.some((d) => d.plots.some((id) => built.plots.has(id)))).toBe(false);
  });

  it('new Chogs take the next plot in order, and the first district appears once the main island is full', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const names: string[] = [];
    for (let i = 0; i < 6; i += 1) names.push(client.welcomeChog()!);
    expect(new Set(names).size).toBe(6);
    const world = (await client.getSnapshot()).world;
    expect(world.agents.map((a) => a.plotId).slice(-6)).toEqual(['p09', 'p10', 'p11', 'p12', 'p13', 'p14']);
    const built = builtUp(world);
    const east = DISTRICTS.find((d) => d.id === 'east')!;
    expect(east.plots.filter((id) => built.plots.has(id))).toEqual(['p13', 'p14', 'p15', 'p16']);
    expect(DISTRICTS.filter((d) => d.id !== 'east').some((d) => d.plots.some((id) => built.plots.has(id)))).toBe(false);
  });

  it('says so when every plot is taken', async () => {
    const client = new FixtureCityClient({ autoStart: false });
    const world = (await client.getSnapshot()).world;
    for (let i = world.agents.length; i < world.plots.length; i += 1) expect(client.welcomeChog()).not.toBeNull();
    expect(client.welcomeChog()).toBeNull();
  });

  it('lays every district home on its own ground, off the main island and clear of its neighbours', () => {
    const homes = DISTRICTS.flatMap((d) => d.plots.map((id) => PLOTS[id]!));
    expect(homes).toHaveLength(24);
    for (const h of homes) expect(Math.abs(h.x) > 13 || h.z > 10.5).toBe(true);
    for (let i = 0; i < homes.length; i += 1) {
      for (let j = i + 1; j < homes.length; j += 1) expect(Math.hypot(homes[i]!.x - homes[j]!.x, homes[i]!.z - homes[j]!.z)).toBeGreaterThan(1.9);
    }
  });
});
