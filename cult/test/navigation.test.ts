import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('World entry points', () => {
  it('offers Soul and City without a separate Cult landing entry', () => {
    const landing = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
    expect(landing).not.toMatch(/href="\/cult\/?"/);
    expect(landing).not.toContain('Three worlds, one Chog');
    expect(landing).toContain('href="/city/"');
    const soul = readFileSync(new URL('../web/src/soul/SoulPage.tsx', import.meta.url), 'utf8');
    expect(soul).not.toContain('href="/cult/"');
  });
});
