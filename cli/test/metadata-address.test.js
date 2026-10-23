import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, safeLookup } from '../src/network.js';
test('metadata destinations reject private, unspecified, mapped and reserved IP ranges', () => {
  for (const ip of ['0.0.0.0', '127.0.0.1', '10.1.1.1', '169.254.169.254', '192.168.1.1', '172.16.0.1', '100.64.1.1', '224.0.0.1', '::1', '::', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2001:0db8::1', '2001:0000::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
});
test('DNS resolution is validated in the socket lookup callback, including mixed answers', async () => {
  const resolved = records => (host, opts, cb) => cb(null, records);
  const lookup = records => new Promise((resolve, reject) => safeLookup('metadata.example', { all: true }, (error, records) => error ? reject(error) : resolve(records), resolved(records)));
  await assert.rejects(lookup([{ address: '127.0.0.1', family: 4 }]), /public/);
  await assert.rejects(lookup([{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }]), /public/);
  assert.deepEqual(await lookup([{ address: '8.8.8.8', family: 4 }]), [{ address: '8.8.8.8', family: 4 }]);
});
