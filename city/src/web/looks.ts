// Where a resident's look comes from. Fixture residents wear real Chog Genesis tokens (re-dressable
// from the fixture tools); a resident on the Chog server wears its own token's look.
import { useSyncExternalStore } from 'react';
import type { AgentState } from '../shared/contracts';
import { appearanceOf, DEFAULT_APPEARANCE, type Appearance, type ChogLook } from '../shared/looks';
import { genesisLook } from '../fixtures/chog-genesis';
import { FIXTURE_COLLECTION } from '../fixtures/residents';
import { DEFAULT_WEARS, fixtureLook, randomWears } from '../fixtures/looks';

let wears: readonly number[] = DEFAULT_WEARS;
const listeners = new Set<() => void>();

/** Dress the fixture village as random Chogs from the whole collection. */
export function redressVillage(count: number): void {
  wears = randomWears(count);
  cache.clear();
  listeners.forEach((l) => l());
}

/** Re-render when the fixture village is re-dressed. */
export function useWears(): readonly number[] {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => wears,
  );
}

export function lookOf(agent: AgentState): ChogLook | null {
  if (agent.identity.collection.toLowerCase() === FIXTURE_COLLECTION) return fixtureLook(agent.identity.tokenId, wears);
  // Chog Genesis residents wear their own token; a local test collection borrows the same token number's look.
  return genesisLook(agent.identity.tokenId);
}

const cache = new Map<string, Appearance>();

export function appearanceFor(agent: AgentState): Appearance {
  let a = cache.get(agent.key);
  if (!a) {
    const look = lookOf(agent);
    a = look ? appearanceOf(look.traits) : DEFAULT_APPEARANCE;
    cache.set(agent.key, a);
  }
  return a;
}
