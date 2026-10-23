import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { get } from 'node:http';
import { startLogin } from '../src/login.js';

test('loopback login verifies one exact wallet challenge and never returns signature or local credential', async t => {
  let saved;
  const login = await startLogin({ save: value => { saved = value; }, timeoutMs: 5000 });
  t.after(() => login.close());
  const wallet = Wallet.createRandom();
  const badHost = await new Promise((resolve, reject) => get(login.url, { headers: { host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject));
  assert.equal(badHost, 403);
  const post = (path, data, extra = {}) => fetch(login.origin + path, { method: 'POST', headers: { origin: login.origin, 'content-type': 'application/json', 'x-chog-state': login.state, ...extra }, body: JSON.stringify(data) });
  assert.equal((await post('/challenge', { address: wallet.address }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/challenge', { address: wallet.address }, { 'x-chog-state': 'wrong' })).status, 403);
  const { message } = await (await post('/challenge', { address: wallet.address })).json();
  assert.match(message, /Chain ID: 143/);
  assert.match(message, /does not authorize transactions/);
  assert.equal((await post('/verify', { message: message + 'tampered', signature: await wallet.signMessage(message) })).status, 400);
  assert.equal((await post('/verify', { message, signature: await Wallet.createRandom().signMessage(message) })).status, 400);
  const reply = await (await post('/verify', { message, signature: await wallet.signMessage(message) })).json();
  assert.equal(reply.address, wallet.address.toLowerCase());
  assert.ok(!JSON.stringify(saved).includes('signature'));
  assert.ok(!JSON.stringify(saved).includes(message));
  assert.equal((await login.promise).address, wallet.address.toLowerCase());
});
test('login times out and closes its HTTP listener', async () => {
  const login = await startLogin({ save() {}, timeoutMs: 50 });
  await assert.rejects(login.promise, /timed out/);
  await assert.rejects(fetch(login.url));
});

for (const count of [0, 1, 2]) test(`Normies flow discovers owned Chogs and ${count === 1 ? 'auto-selects one' : count === 2 ? 'offers a picker' : 'handles no eligible Chogs'}`, async t => {
  const wallet = Wallet.createRandom();
  const chosen = [];
  const chogs = Array.from({ length: count }, (_, index) => ({ tokenId: String(index + 10), name: `Chog ${index + 1}`, awakened: true }));
  const login = await startLogin({ save() {}, discover: async address => { assert.equal(address, wallet.address.toLowerCase()); return chogs; }, select: async tokenId => { chosen.push(tokenId); return { name: chogs.find(chog => chog.tokenId === tokenId).name }; }, timeoutMs: 5000 });
  t.after(() => login.close());
  const post = (path, body) => fetch(login.origin + path, { method: 'POST', headers: { origin: login.origin, 'content-type': 'application/json', 'x-chog-state': login.state }, body: JSON.stringify(body) });
  const { message } = await (await post('/challenge', { address: wallet.address })).json();
  const response = await (await post('/verify', { message, signature: await wallet.signMessage(message) })).json();
  if (count === 2) {
    assert.equal(response.requiresSelection, true);
    assert.equal(response.chogs.length, 2);
    assert.deepEqual(chosen, []);
    assert.equal((await post('/select', { tokenId: '999' })).status, 403);
    assert.equal((await post('/verify', { message, signature: await wallet.signMessage(message) })).status, 403);
    assert.equal((await (await post('/select', { tokenId: '11' })).json()).selected.name, 'Chog 2');
    assert.equal((await login.promise).selected.name, 'Chog 2');
  } else {
    assert.equal(response.requiresSelection, false);
    assert.equal((await login.promise).selected?.name ?? null, count === 1 ? 'Chog 1' : null);
    assert.deepEqual(chosen, count === 1 ? ['10'] : []);
  }
});
test('unawakened owned Chogs are displayed but cannot be selected', async t => {
  const wallet = Wallet.createRandom();
  const login = await startLogin({ save() {}, discover: async () => [{ tokenId: '1', name: 'Sleeping Chog', awakened: false }, { tokenId: '2', name: 'Ready Chog', awakened: true }, { tokenId: '3', name: 'Other Chog', awakened: true }], select: async () => ({ name: 'Selected' }), timeoutMs: 5000 });
  t.after(() => login.close());
  const post = (path, body) => fetch(login.origin + path, { method: 'POST', headers: { origin: login.origin, 'content-type': 'application/json', 'x-chog-state': login.state }, body: JSON.stringify(body) });
  const { message } = await (await post('/challenge', { address: wallet.address })).json();
  const response = await (await post('/verify', { message, signature: await wallet.signMessage(message) })).json();
  assert.equal(response.chogs[0].awakened, false);
  assert.equal((await post('/select', { tokenId: '1' })).status, 403);
});
test('a failed discovery retries in the signed session without another wallet signature', async t => {
  let reads = 0;
  const wallet = Wallet.createRandom();
  const login = await startLogin({ save() {}, discover: async () => { if (++reads === 1) throw Error('RPC temporarily unavailable'); return [{ tokenId: '9', name: 'My Chog', awakened: true }]; }, select: async () => ({ name: 'My Chog' }), timeoutMs: 5000 });
  t.after(() => login.close());
  const post = (path, body) => fetch(login.origin + path, { method: 'POST', headers: { origin: login.origin, 'content-type': 'application/json', 'x-chog-state': login.state }, body: JSON.stringify(body) });
  const { message } = await (await post('/challenge', { address: wallet.address })).json();
  const failure = await (await post('/verify', { message, signature: await wallet.signMessage(message) })).json();
  assert.equal(failure.canRetryDiscovery, true);
  const retry = await post('/discover', {});
  assert.equal(retry.status, 200);
  assert.equal((await login.promise).selected.name, 'My Chog');
  assert.equal(reads, 2);
});
