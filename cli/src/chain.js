import { Interface, id, keccak256, zeroPadValue, toBeHex, getAddress, formatUnits } from 'ethers';
import { networkUrl, readJson } from './network.js';
import { galleryChog } from './gallery.js';

export const NFT = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
export const ADAPTER = '0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02';
export const REGISTRY = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432';
export const ADAPTER_HASH = '0x5bd361efef40352c1299780dbe2b23176fcfe1f3f40c5c8d87bc1e70517ebf16';
export const CHOG = '0x350035555e10d9afaf1566aaebfced5ba6c27777';
export const TRANSFER = id('Transfer(address,address,uint256)');
const erc721 = new Interface(['function balanceOf(address) view returns(uint256)', 'function ownerOf(uint256) view returns(address)', 'function tokenURI(uint256) view returns(string)']);
const adapter = new Interface(['function agentOf(uint256) view returns(uint256)', 'function bindingOf(uint256) view returns(uint8,address,uint256)', 'function collection() view returns(address)', 'function identityRegistry() view returns(address)', 'error NotAwakened(uint256)']);
const multicall = new Interface(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns((bool success,bytes returnData)[] returnData)']);
const MULTICALL = '0xca11bde05977b3631167028862be2a173976ca11';
const erc20 = new Interface(['function balanceOf(address) view returns(uint256)', 'function totalSupply() view returns(uint256)', 'function decimals() view returns(uint8)']);
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call', 'eth_getLogs', 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
const HEX = /^0x[0-9a-fA-F]+$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
export class ReimportRequired extends Error { code = 'REIMPORT_REQUIRED'; }
export const tokenNumber = value => {
  if (!/^[1-9][0-9]{0,3}$/.test(String(value)) || BigInt(value) > 1969n) throw Error('Chog Genesis token ID must be 1–1969.');
  return String(value);
};
export class Chain {
  constructor({ rpcUrl = process.env.CHOG_RPC_URL || 'https://rpc.monad.xyz', fetchImpl = fetch } = {}) {
    this.url = networkUrl(rpcUrl, { local: true }); this.fetch = fetchImpl; this.counter = 0;
  }
  async request(method, params, signal) {
    if (!METHODS.has(method)) throw Error('This RPC client is read-only.');
    const requestId = ++this.counter;
    let response;
    try { response = await this.fetch(this.url, { method: 'POST', redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) }); }
    catch { throw Error('Monad RPC is unavailable or the request was cancelled.'); }
    const body = await readJson(response, 1048576);
    if (body?.error && method === 'eth_call' && params[0]?.to === ADAPTER && params[0]?.data?.startsWith(adapter.getFunction('agentOf').selector)) throw Error('Cannot read an awakened Chog identity. Import requires an awakened token; otherwise check your RPC provider.');
    if (body?.jsonrpc !== '2.0' || body.id !== requestId || body.error || !Object.hasOwn(body, 'result')) throw Error(`Monad RPC could not complete ${method}.`);
    return body.result;
  }
  async finalized(signal) {
    const chain = await this.request('eth_chainId', [], signal);
    if (chain !== '0x8f') throw Error('Wrong chain: this release supports Monad mainnet (143) only.');
    const block = await this.request('eth_getBlockByNumber', ['finalized', false], signal);
    if (!block || !HEX.test(block.number) || !HASH.test(block.hash)) throw Error('RPC returned an invalid finalized block.');
    return { number: BigInt(block.number).toString(), hash: block.hash.toLowerCase() };
  }
  async call(to, contract, method, args, at, signal) {
    const raw = await this.request('eth_call', [{ to, data: contract.encodeFunctionData(method, args), gas: '0x30d40' }, { blockHash: at.hash, requireCanonical: true }], signal);
    try { return contract.decodeFunctionResult(method, raw); } catch { throw Error(`Invalid contract result for ${method}.`); }
  }
  async owned(address, signal) {
    address = getAddress(address).toLowerCase();
    const at = await this.finalized(signal);
    const balance = Number((await this.call(NFT, erc721, 'balanceOf', [address], at, signal))[0]);
    if (!Number.isInteger(balance) || balance < 0 || balance > 1969) throw Error('Invalid Chog collection balance.');
    if (!balance) return [];
    const batches = async calls => {
      const results = new Array(Math.ceil(calls.length / 100));
      let next = 0;
      const worker = async () => {
        for (let index = next++; index < results.length; index = next++) {
          const batch = calls.slice(index * 100, index * 100 + 100);
          const raw = await this.request('eth_call', [{ to: MULTICALL, data: multicall.encodeFunctionData('aggregate3', [batch]), gas: '0x989680' }, { blockHash: at.hash, requireCanonical: true }], signal);
          const decoded = multicall.decodeFunctionResult('aggregate3', raw)[0];
          if (decoded.length !== batch.length) throw Error('Incomplete wallet discovery. Try another RPC.');
          results[index] = Array.from(decoded);
        }
      };
      await Promise.all([worker(), worker()]);
      return results.flat();
    };
    const owners = await batches(Array.from({ length: 1969 }, (_, index) => ({ target: NFT, allowFailure: true, callData: erc721.encodeFunctionData('ownerOf', [index + 1]) })));
    const ids = owners.flatMap((answer, index) => answer.success && erc721.decodeFunctionResult('ownerOf', answer.returnData)[0].toLowerCase() === address ? [String(index + 1)] : []);
    if (ids.length !== balance) throw Error('Incomplete wallet discovery. No selection was made; try another RPC.');
    const agents = await batches(ids.map(tokenId => ({ target: ADAPTER, allowFailure: true, callData: adapter.encodeFunctionData('agentOf', [tokenId]) })));
    return ids.map((tokenId, index) => {
      const answer = agents[index];
      if (answer.success) adapter.decodeFunctionResult('agentOf', answer.returnData);
      else if (answer.returnData.toLowerCase() !== adapter.encodeErrorResult('NotAwakened', [tokenId]).toLowerCase()) throw Error('Cannot verify Chog awakening status. Try another RPC.');
      const { metadata: _metadata, ...display } = galleryChog(tokenId);
      return { ...display, awakened: answer.success };
    });
  }
  async importToken(tokenId, signal) {
    tokenId = tokenNumber(tokenId);
    const at = await this.finalized(signal);
    const code = await this.request('eth_getCode', [ADAPTER, { blockHash: at.hash, requireCanonical: true }], signal);
    if (typeof code !== 'string' || keccak256(code) !== ADAPTER_HASH) throw Error('Chog adapter code does not match the reviewed deployment.');
    const collection = (await this.call(ADAPTER, adapter, 'collection', [], at, signal))[0].toLowerCase();
    const registry = (await this.call(ADAPTER, adapter, 'identityRegistry', [], at, signal))[0].toLowerCase();
    if (collection !== NFT || registry !== REGISTRY) throw Error('Unexpected Chog deployment binding.');
    const agentId = (await this.call(ADAPTER, adapter, 'agentOf', [tokenId], at, signal))[0].toString();
    const binding = await this.call(ADAPTER, adapter, 'bindingOf', [agentId], at, signal);
    if (Number(binding[0]) !== 0 || binding[1].toLowerCase() !== NFT || binding[2].toString() !== tokenId) throw Error('Invalid agent NFT binding.');
    const owner = (await this.call(NFT, erc721, 'ownerOf', [tokenId], at, signal))[0].toLowerCase();
    const metadataUri = (await this.call(NFT, erc721, 'tokenURI', [tokenId], at, signal))[0];
    return { identity: { chainId: 143, registry: REGISTRY, adapter: ADAPTER, collection: NFT, tokenId, agentId }, owner, metadataUri, checkpoint: at };
  }
  async verify(selection, signal) {
    const at = await this.finalized(signal);
    const from = BigInt(selection.checkpoint.number), to = BigInt(at.number);
    if (to < from || to - from > 10000n) throw new ReimportRequired('Ownership history needs a fresh import (verification gap).');
    const previous = await this.request('eth_getBlockByNumber', [toBeHex(from), false], signal);
    if (previous?.hash?.toLowerCase() !== selection.checkpoint.hash) throw new ReimportRequired('Ownership checkpoint changed; import again.');
    const owner = (await this.call(NFT, erc721, 'ownerOf', [selection.identity.tokenId], at, signal))[0].toLowerCase();
    if (owner !== selection.address) throw new ReimportRequired('Current wallet no longer holds this Chog. Import an owned token.');
    for (let start = from + 1n; start <= to; start += 100n) {
      const end = start + 99n > to ? to : start + 99n;
      const logs = await this.request('eth_getLogs', [{ address: NFT, topics: [TRANSFER, null, null, zeroPadValue(toBeHex(BigInt(selection.identity.tokenId)), 32)], fromBlock: toBeHex(start), toBlock: toBeHex(end) }], signal);
      if (!Array.isArray(logs)) throw Error('Unverifiable ownership history. Try another RPC.');
      if (logs.length) throw new ReimportRequired('Ownership history changed; import again.');
    }
    return at;
  }
  async transaction(hash, signal) {
    if (!HASH.test(hash)) throw Error('Expected a transaction hash.');
    const at = await this.finalized(signal);
    const tx = await this.request('eth_getTransactionByHash', [hash], signal);
    const receipt = await this.request('eth_getTransactionReceipt', [hash], signal);
    if (!tx) throw Error('Transaction not found.');
    return { chainId: 143, observedAt: new Date().toISOString(), finalizedBlock: at.number, source: this.url.origin, transaction: tx, receipt, final: receipt?.blockNumber ? BigInt(receipt.blockNumber) <= BigInt(at.number) : false };
  }
  async tokenReport(address, signal) {
    address = getAddress(address);
    const at = await this.finalized(signal);
    const decimals = Number((await this.call(CHOG, erc20, 'decimals', [], at, signal))[0]);
    if (decimals !== 18) throw Error('Unexpected $CHOG decimals.');
    const balance = (await this.call(CHOG, erc20, 'balanceOf', [address], at, signal))[0];
    const supply = (await this.call(CHOG, erc20, 'totalSupply', [], at, signal))[0];
    return { chainId: 143, token: CHOG, address, balance: formatUnits(balance, decimals), totalSupply: formatUnits(supply, decimals), block: at, observedAt: new Date().toISOString(), source: this.url.origin, omissions: ['Market price, liquidity, volume, holder concentration and hosted credits are not provided by this report.'] };
  }
}
