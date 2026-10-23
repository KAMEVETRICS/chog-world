import { describe, expect, it } from 'vitest';
import { appearanceOf } from '../../src/shared/looks';
import { DEFAULT_WEARS, fixtureLook, randomWears } from '../../src/fixtures/looks';
import { GENESIS_SUPPLY, genesisLook } from '../../src/fixtures/chog-genesis';

describe('appearance from Chog Genesis traits', () => {
  it('maps the real Chog Genesis #1 (MCGA cap, BTC glasses, Fwog, jersey, pink skin)', () => {
    const look = fixtureLook('0')!;
    expect(look.sourceTokenId).toBe('1');
    // Token #1's metadata lives in file 1462 (the reveal shuffled them): looks go by token ID.
    expect(look.image).toMatch(/\/1462\.webp$/);
    const a = appearanceOf(look.traits);
    expect(a.hat.kind).toBe('cap');
    expect(a.eyes.kind).toBe('btc');
    expect(a.held).toBe('frog');
    expect(a.outfit.kind).toBe('tee');
    expect(a.outfit.color).toBe('#efc236');
    expect(a.skin.fur).toBe('#ee8db6');
  });

  it('gives dark-skinned Chogs a dark face, and laser eyes a beam colour', () => {
    expect(appearanceOf({ Skin: 'Black' }).skin.mask).toBe('#6b3e27');
    expect(appearanceOf({ Eyes: 'Purple laser' }).eyes).toEqual({ kind: 'laser', color: '#c04bff' });
    expect(appearanceOf({ Eyes: 'fire laser' }).eyes.color).toBe('#ff7a2c');
  });

  it('recognises headwear archetypes', () => {
    const kind = (Head: string) => appearanceOf({ Head }).hat.kind;
    expect(kind('Crown')).toBe('crown');
    expect(kind('Wizard Hat')).toBe('wizard');
    expect(kind('Russian Hat')).toBe('ushanka');
    expect(kind('Blue Bucket Cap')).toBe('bucket');
    expect(kind('Thunder Cap')).toBe('bucket');
    expect(kind('Spartan Helmet')).toBe('helmet');
    expect(kind('Demon Horn')).toBe('horns');
    expect(kind('Bob Hair')).toBe('hair');
    expect(kind('Choggie Beanie')).toBe('beanie');
  });

  it('falls back to the classic purple Chog for unknown or missing traits', () => {
    const a = appearanceOf({});
    expect(a.skin.fur).toBe('#5b36b0');
    expect(a.hat.kind).toBe('none');
    expect(a.outfit.kind).toBe('none');
    expect(a.eyes.kind).toBe('round');
  });

  it('every fixture resident wears a real token with an image', () => {
    DEFAULT_WEARS.forEach((token, i) => {
      const look = fixtureLook(String(i))!;
      expect(look.sourceTokenId).toBe(String(token));
      expect(look.image).toMatch(/^https:\/\//);
    });
  });

  it('reads thorn crowns, grey skin and space suits correctly', () => {
    expect(appearanceOf({ Head: 'Silver Thorn' }).hat.kind).toBe('laurel');
    expect(appearanceOf({ Skin: 'Grey' }).skin.fur).not.toBe(appearanceOf({}).skin.fur);
    expect(appearanceOf({ Body: 'Astro Suit' }).outfit.kind).toBe('armor');
  });

  it('re-dressing picks distinct tokens from the whole collection', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const wears = randomWears(8, random);
    expect(new Set(wears).size).toBe(8);
    for (const id of wears) {
      expect(id).toBeGreaterThanOrEqual(1);
      expect(id).toBeLessThanOrEqual(GENESIS_SUPPLY);
    }
    expect(genesisLook(0)).toBeNull();
    expect(genesisLook(GENESIS_SUPPLY + 1)).toBeNull();
  });
});
