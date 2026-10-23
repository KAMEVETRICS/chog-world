import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { personaFor } from '../src/persona.js';
const require = createRequire(import.meta.url);
test('bundled gallery exactly matches City artwork and collection traits', () => {
  const local = JSON.parse(readFileSync(new URL('../src/genesis-gallery.json', import.meta.url), 'utf8'));
  const city = JSON.parse(readFileSync(new URL('../../city/src/fixtures/chog-genesis.json', import.meta.url), 'utf8'));
  assert.deepEqual(local, city);
});
test('local persona logic matches the current Soul implementation across all trait rules', async () => {
  const ts = require('typescript');
  const hashSource = readFileSync(new URL('../../cult/src/engine/hash.ts', import.meta.url), 'utf8');
  const hashCode = ts.transpileModule(hashSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const source = readFileSync(new URL('../../cult/src/soul/persona.ts', import.meta.url), 'utf8').replace('"../engine/hash.js"', JSON.stringify('data:text/javascript;base64,' + Buffer.from(hashCode).toString('base64')));
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const current = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const values = ['fiery', 'royal', 'yellow', 'aqua', 'purple', 'clean', 'laser', 'crying', 'clown', 'dead', 'side', 'happy', 'bubblegum', 'drool', 'smile', 'worried', 'tuxedo', 'robe', 'armor', 'hoodie', 'glitch', 'astro', 'farmer', 'hawaiian', 'banana', 'squid', 'homeless', 'dragon', 'wizard', 'crown', 'neet', '10k', 'mon', 'dollar', 'gold', 'btc', 'vr', 'retro'];
  for (const value of values) {
    const traits = Object.fromEntries(['aura', 'eyes', 'mouth', 'body', 'head', 'background'].map(key => [key, value]));
    assert.deepEqual(personaFor('Chog #42', traits, 'key42'), current.personaFor('Chog #42', traits, 'key42'));
  }
});
