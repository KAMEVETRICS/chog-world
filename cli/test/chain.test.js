import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Interface } from 'ethers';
import { Chain, NFT, ADAPTER, TRANSFER } from '../src/chain.js';
const hex = n => '0x' + n.toString(16);
const hash = n => '0x' + n.toString(16).padStart(64, '0');
const owner = '0x' + '11'.repeat(20);
const erc721 = new Interface(['function ownerOf(uint256) view returns(address)']);
const selection = { address: owner, identity: { tokenId: '42' }, checkpoint: { number: '100', hash: hash(100) } };
function chainWith({ transfer = false, end = 305, wrongCheckpoint = false, methodError = false } = {}) {
  const seen = [];
  const chain = new Chain({ rpcUrl: 'https://rpc.example', fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body); seen.push(body);
    let result;
    if (body.method === 'eth_chainId') result = '0x8f';
    else if (body.method === 'eth_getBlockByNumber') result = body.params[0] === 'finalized' ? { number: hex(end), hash: hash(end) } : { number: '0x64', hash: hash(wrongCheckpoint ? 99 : 100) };
    else if (body.method === 'eth_call') result = erc721.encodeFunctionResult('ownerOf', [owner]);
    else if (body.method === 'eth_getLogs') result = transfer ? [{}] : [];
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...(methodError ? { error: { code: -32000, message: 'secret provider URL must not be echoed' } } : { result }) }));
  } });
  return { chain, seen };
}
test('ownership checks are finalized, pinned by hash and scan every missed block in bounded ranges', async () => {
  const { chain, seen } = chainWith();
  assert.deepEqual(await chain.verify(selection), { number: '305', hash: hash(305) });
  const call = seen.find(x => x.method === 'eth_call');
  assert.deepEqual(call.params[1], { blockHash: hash(305), requireCanonical: true });
  const ranges = seen.filter(x => x.method === 'eth_getLogs').map(x => x.params[0]);
  assert.deepEqual(ranges.map(x => [BigInt(x.fromBlock), BigInt(x.toBlock)]), [[101n, 200n], [201n, 300n], [301n, 305n]]);
  assert.ok(ranges.every(x => x.address === NFT && x.topics[0] === TRANSFER && x.topics[3].endsWith('2a')));
});
test('reacquisition, checkpoint reorg and large gaps force a new ownership generation', async () => {
  for (const options of [{ transfer: true }, { wrongCheckpoint: true }, { end: 20000 }]) {
    await assert.rejects(chainWith(options).chain.verify(selection), error => error.code === 'REIMPORT_REQUIRED');
  }
});
test('provider errors are bounded and do not echo its secret response text', async () => {
  await assert.rejects(chainWith({ methodError: true }).chain.verify(selection), error => !error.message.includes('secret provider'));
  const chain = new Chain({ rpcUrl: 'https://rpc.example', fetchImpl: async () => new Response('x'.repeat(1048577)) });
  await assert.rejects(chain.finalized(), /too large/);
});
test('agent lookup failures explain the awakening prerequisite without claiming a successful import', async () => {
  const { chain } = chainWith({ methodError: true });
  await assert.rejects(chain.request('eth_call', [{ to: ADAPTER, data: '0x6cb75a1e' }]), /awakened/);
});
