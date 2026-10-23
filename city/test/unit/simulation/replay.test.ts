import { describe, expect, it } from 'vitest';
import { makeFixtureWorld } from '../../../src/fixtures/residents';
import { hashWorld, step } from '../../../src/simulation/step';

describe('determinism', () => {
  it('identical input, seed and ruleset yield an identical result hash', () => {
    let a = makeFixtureWorld();
    let b = makeFixtureWorld();
    for (let i = 0; i < 50; i += 1) {
      const ra = step({ world: a });
      const rb = step({ world: b });
      expect(ra.resultHash).toBe(rb.resultHash);
      expect(ra.resultHash).toBe(hashWorld(ra.world));
      a = ra.world;
      b = rb.world;
    }
  });

  it('a different state yields a different hash', () => {
    const world = makeFixtureWorld();
    const other = structuredClone(world);
    other.agents[0]!.inventory.wood.total += 1;
    expect(hashWorld(world)).not.toBe(hashWorld(other));
  });

  it('the hash ignores object key order', () => {
    const reverseKeys = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverseKeys);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverseKeys(v)]));
      }
      return value;
    };
    const world = makeFixtureWorld();
    expect(hashWorld(reverseKeys(world) as typeof world)).toBe(hashWorld(world));
  });
});
