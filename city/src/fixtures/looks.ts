// Fixture residents (test IDs 0-7) each wear a real Chog Genesis token, so the demo shows what
// holders will actually see. The worn token is always labelled; live mode reads each resident's own.
import type { ChogLook } from '../shared/looks';
import { GENESIS_SUPPLY, genesisLook } from './chog-genesis';

/** Default line-up, picked from the full collection for variety (skins, headwear, outfits, eyes). */
export const DEFAULT_WEARS: readonly number[] = [1, 186, 173, 75, 93, 862, 981, 923];

/** Look for fixture resident `tokenId` (0, 1, 2...) wearing the given Chog Genesis tokens. */
export function fixtureLook(tokenId: string, wears: readonly number[] = DEFAULT_WEARS): ChogLook | null {
  const n = Number(tokenId);
  // Past the line-up, each newcomer wears a token spread across the collection, so no two look alike.
  const worn = wears[n] ?? 1 + ((n * 761) % GENESIS_SUPPLY);
  return genesisLook(worn);
}

/** `count` distinct random Chog Genesis token IDs. */
export function randomWears(count: number, random: () => number = Math.random): number[] {
  const picked = new Set<number>();
  while (picked.size < Math.min(count, GENESIS_SUPPLY)) {
    const id = 1 + Math.floor(random() * GENESIS_SUPPLY);
    if (genesisLook(id)) picked.add(id);
  }
  return [...picked];
}
