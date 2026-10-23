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
