// Every Chog Genesis token's traits, read from the collection itself: tokenURI(id) on Monad mainnet,
// then the metadata it points to. Note that token #N's metadata is generally NOT file N.json
// (the reveal shuffled them), so looks must always be found by token ID through this table.
import type { ChogLook, ChogTraits } from '../shared/looks';
import data from './chog-genesis.json';

export const GENESIS_CONTRACT = '0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763';
export const GENESIS_SUPPLY = data.tokens.length;

/** The look of Chog Genesis #`tokenId` (1..1969), or null if unknown. */
export function genesisLook(tokenId: number | string): ChogLook | null {
  const id = Number(tokenId);
  const row = Number.isInteger(id) ? data.tokens[id - 1] : undefined;
  if (!row) return null;
  const [file, ...picks] = row;
  const traits: Record<string, string> = {};
  data.traits.forEach((name, i) => {
    const v = picks[i]!;
    if (v >= 0) traits[name] = data.values[i]![v]!;
  });
  return { sourceTokenId: String(id), image: `${data.imageBase}${file}.webp`, traits: traits as ChogTraits };
}
