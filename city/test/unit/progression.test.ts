import { describe, expect, it } from 'vitest';
import { makeFixtureWorld } from '../../src/fixtures/residents';
import { GATHER_SITES, HOME_RECIPES, MAX_HOME_LEVEL, RESOURCE_CAP, SITE_FOR } from '../../src/shared/rules';
import { PROJECT_IDS, RESOURCES } from '../../src/shared/contracts';
import { step } from '../../src/simulation/step';
import { dayOf } from '../../src/simulation/citizens';
import { homeName } from '../../src/web/format';
import { newlyEarned, titleOf } from '../../src/web/resident/titles';
import { growthOf, GROWTH_RULES, maxGrowth, RANKS } from '../../src/web/town/rank';

describe('five home levels', () => {
  it('every cost fits in a storehouse a Chog can actually fill', () => {
    for (const recipe of HOME_RECIPES) {
      for (const r of RESOURCES) {
        const site = GATHER_SITES[SITE_FOR[r]]!;
        // Sites with an input stop when another trip would overflow; the last reachable stock is cap - yield + 1 or more.
        const reachable = site.input ? RESOURCE_CAP - site.yield : RESOURCE_CAP;
        expect(recipe.costs[r], `level ${recipe.level} ${r}`).toBeLessThanOrEqual(reachable);
      }
    }
  });

  it('a builder climbs all the way to level 5, one level at a time', () => {
    let world = makeFixtureWorld({ residentCount: 1 });
    const reached: number[] = [];
    for (let t = 0; t < 36 * 12 && world.agents[0]!.homeLevel < MAX_HOME_LEVEL; t += 1) {
      world = step({ world }).world;
      if (world.agents[0]!.homeLevel > reached.length) reached.push(dayOf(world.tick));
    }
    expect(world.agents[0]!.homeLevel).toBe(MAX_HOME_LEVEL);
    expect(reached).toHaveLength(MAX_HOME_LEVEL);
    expect(reached).toEqual([...reached].sort((a, b) => a - b));
  });

  it('names every level of every style, and the tent before', () => {
    expect(homeName('cottage', 0)).toBe('tent');
    expect(homeName('cottage', 5)).toBe('manor');
    expect(homeName('workshop', 4)).toBe('mill');
    expect(homeName('treehouse', 5)).toBe('tree palace');
  });
});

describe('titles', () => {
  it('follow the home ladder, and a full garden is its own milestone', () => {
    const agent = makeFixtureWorld({ residentCount: 1 }).agents[0]!;
    expect(titleOf(agent)).toBe('Newcomer');
    expect(titleOf({ ...agent, homeLevel: 3 })).toBe('Craftsman');
    const earned = newlyEarned({ homeLevel: 1, decor: [] }, { ...agent, homeLevel: 5, decor: ['lantern', 'flowerbed', 'bench', 'well'] });
    expect(earned.map((m) => m.title)).toEqual(['Homeowner', 'Craftsman', 'Landowner', 'Master Builder', 'Gardener']);
  });
});

describe('village rank', () => {
  it("every rank is reachable by the founding village alone (main island and Newcomers' Row), the top one only when nearly finished", () => {
    const full = makeFixtureWorld();
    const world = { ...full, plots: full.plots.slice(0, 12) };
    const max = maxGrowth(world);
    expect(max).toBe(world.plots.length * MAX_HOME_LEVEL * GROWTH_RULES.homeLevel + world.lots.length * GROWTH_RULES.villager + PROJECT_IDS.length * GROWTH_RULES.project);
    for (const rank of RANKS) expect(rank.from, `${rank.name} needs ${rank.from} of ${max}`).toBeLessThanOrEqual(max);
    const top = RANKS[RANKS.length - 1]!;
    expect(top.from / max).toBeGreaterThan(0.75);
    // Ranks get further apart as the village grows, never closer.
    const gaps = RANKS.slice(1).map((r, i) => r.from - RANKS[i]!.from);
    expect(gaps).toEqual([...gaps].sort((a, b) => a - b));
  });

  it('grows from homes, villagers and shared projects', () => {
    const world = makeFixtureWorld();
    const start = growthOf(world);
    expect(start.rank.name).toBe('Hamlet');
    const built = { ...world, agents: world.agents.map((a) => ({ ...a, homeLevel: 3 })) };
    expect(growthOf(built).points).toBe(start.points + 3 * world.agents.length);
    const withFountain = { ...built, projects: { ...built.projects, fountain: { ...built.projects.fountain, completedTick: '1' } } };
    expect(growthOf(withFountain).rank.name).toBe('Village');
    const top = growthOf({ ...withFountain, agents: Array.from({ length: 30 }, (_, i) => ({ ...world.agents[0]!, key: `k${i}`, homeLevel: 5 })) });
    expect(top.rank).toBe(RANKS[RANKS.length - 1]);
    expect(top.journey).toBe(1);
  });
});
