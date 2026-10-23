import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Wallet } from 'ethers';
import { Chain, NFT, ADAPTER, REGISTRY, ReimportRequired } from '../src/chain.js';
import { LocalStore } from '../src/store.js';
import { ChogCore } from '../src/core.js';
import { personaFor } from '../src/persona.js';
import { setupCommand } from '../src/setup.js';

const holder = Wallet.createRandom();
const hash = '0x' + 'ab'.repeat(32);
function fakeChain() {
  let owner = holder.address.toLowerCase(), block = 100n, logs = [];
  return {
    importToken: async tokenId => ({ identity: { chainId: 143, registry: REGISTRY, adapter: ADAPTER, collection: NFT, tokenId, agentId: '42' }, owner, checkpoint: { number: String(block), hash }, metadataUri: 'data:application/json,' + encodeURIComponent(JSON.stringify({ attributes: [{ trait_type: 'Aura', value: 'Royal' }] })) }),
    verify: async selection => {
      if (owner !== holder.address.toLowerCase()) throw new ReimportRequired('Current wallet no longer holds this Chog.');
      if (logs.length || block - BigInt(selection.checkpoint.number) > 10000n) throw new ReimportRequired('Ownership history changed; import again.');
      return { number: String(block), hash };
    },
    change: (nextOwner, nextLogs = []) => { owner = nextOwner; block++; logs = nextLogs; }
  };
}
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'chog-test-'));
  const store = new LocalStore(home);
  t.after(() => { store.close(); rmSync(home, { recursive: true, force: true }); });
  store.saveLogin({ address: holder.address.toLowerCase(), expiresAt: Date.now() + 3600000 });
  const chain = fakeChain();
  const core = new ChogCore({ store, chain });
  return { core, store, chain };
}
test('imports a deterministic persona and works offline without checking RPC', async t => {
  const { core, store, chain } = fixture(t);
  const card = await core.importToken('1');
  assert.equal(card.persona.voice, 'grand, formal speech');
  assert.equal(card.identity.collection, NFT);
  assert.deepEqual(card.persona, personaFor('Chog #1', { Aura: 'Royal' }, card.agentKey));
  chain.verify = () => { throw Error('RPC offline'); };
  assert.equal(core.offlineContext().verification, 'offline-copy');
  await assert.rejects(core.context(), /RPC offline/);
  assert.ok(store.selection());
});
test('memory never crosses accounts or import generations; export excludes memory and login', async t => {
  const { core, store } = fixture(t);
  await core.importToken('1');
  await core.addMemory('Likes short answers');
  assert.equal((await core.memories()).length, 1);
  const exported = core.offlineContext();
  assert.ok(!JSON.stringify(exported).includes('Likes short answers'));
  assert.ok(!JSON.stringify(exported).includes(holder.address.toLowerCase()));
  await core.importToken('1');
  assert.deepEqual(await core.memories(), []);
  store.saveLogin({ address: Wallet.createRandom().address.toLowerCase(), expiresAt: Date.now() + 3600000 });
  await assert.rejects(core.context(), /Import/);
});
test('sale and reacquisition invalidate live access even if current owner matches', async t => {
  const { core, chain } = fixture(t);
  await core.importToken('1');
  await core.addMemory('private');
  chain.change(holder.address.toLowerCase(), [{ transactionHash: hash }]);
  await assert.rejects(core.memories(), /Ownership history/);
  await assert.rejects(core.context(), /Import/);
});
test('expired login cannot authorize private context', async t => {
  const { core, store } = fixture(t);
  await core.importToken('1');
  store.saveLogin({ address: holder.address.toLowerCase(), expiresAt: 1 });
  await assert.rejects(core.memories(), /login/i);
});
test('renewing the same wallet proof retains memory after fresh verification', async t => {
  const { core, store } = fixture(t);
  await core.importToken('1');
  await core.addMemory('Keep this preference');
  store.saveLogin({ address: holder.address.toLowerCase(), expiresAt: Date.now() + 3600000 });
  assert.equal((await core.memories())[0].text, 'Keep this preference');
});
test('RPC allowlist never signs or submits transactions and rejects wrong chain', async () => {
  const chain = new Chain({ rpcUrl: 'https://rpc.example', fetchImpl: async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' })) });
  await assert.rejects(chain.request('eth_sendRawTransaction', []), /read-only/);
  await assert.rejects(chain.finalized(), /chain/i);
});
test('setup commands quote paths and never contain hosted credentials', () => {
  const result = setupCommand('codex', { node: "C:\\My App\\node.exe", entry: "C:\\a'b\\chog.js", platform: 'win32' });
  assert.ok(result.includes("'C:\\a''b\\chog.js'"));
  assert.ok(result.startsWith('codex mcp add chog'));
  assert.match(setupCommand('claude-code', { node: '/a/node', entry: '/a/chog.js', platform: 'linux' }), /claude mcp add --transport stdio --scope user chog --/);
});
