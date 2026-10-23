import { lookup } from 'node:dns';
import { get } from 'node:https';
import { isIP } from 'node:net';

export function networkUrl(value, { local = false } = {}) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:')) throw Error('Use HTTPS (HTTP is allowed only for a local development RPC).');
  if (url.username || url.password || url.hash) throw Error('URL credentials and fragments are not supported.');
  return url;
}

export async function readJson(response, maxBytes = 262144) {
  if (!response.ok) { await response.body?.cancel(); throw Error(`Provider returned HTTP ${response.status}.`); }
  if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw Error('Provider response is too large.'); }
  if (!response.body) throw Error('Provider returned an empty response.');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw Error('Provider response is too large.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function metadata(uri, { gateway = 'https://ipfs.io/ipfs/' } = {}) {
  if (typeof uri !== 'string' || uri.length > 350000) throw Error('Invalid metadata URI.');
  let data;
  if (uri.startsWith('data:application/json')) {
    const match = /^data:application\/json(?:;charset=utf-8)?(;base64)?,(.*)$/is.exec(uri);
    if (!match) throw Error('Unsupported JSON data URI.');
    const text = match[1] ? Buffer.from(match[2], 'base64').toString('utf8') : decodeURIComponent(match[2]);
    if (Buffer.byteLength(text) > 262144) throw Error('Metadata is too large.');
    data = JSON.parse(text);
  } else {
    const target = uri.startsWith('ipfs://') ? new URL(uri.slice(7).replace(/^ipfs\//, ''), gateway.endsWith('/') ? gateway : gateway + '/') : new URL(uri);
    networkUrl(target);
    let response;
    try { response = await metadataFetch(target); }
    catch { throw Error('Metadata provider is unavailable or its destination is not public. You can explicitly supply --metadata-file.'); }
    data = await readJson(response);
  }
  return parseMetadata(data);
}

export function parseMetadata(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.attributes) || data.attributes.length > 100) throw Error('Metadata must contain an attributes array (at most 100 entries).');
  const traits = Object.create(null);
  for (const item of data.attributes) {
    if (!item || typeof item.trait_type !== 'string' || !['string', 'number'].includes(typeof item.value)) continue;
    if (item.trait_type.length > 100 || String(item.value).length > 200) throw Error('Metadata trait is too long.');
    traits[item.trait_type] = String(item.value);
  }
  if (Object.keys(traits).length === 0) throw Error('Metadata contains no usable traits.');
  return { traits: { ...traits } };
}
export function publicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const [firstText, secondText] = address.split(':');
    const first = parseInt(firstText, 16), second = parseInt(secondText || '0', 16);
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
  }
  return false;
}

/** Validate and return the same DNS answers directly to the TLS socket: no second resolution. */
export function safeLookup(host, options, callback, resolver = lookup) {
  resolver(host, { all: true, verbatim: true }, (error, records) => {
    if (error) return callback(Error('Metadata DNS is unavailable.'));
    if (!records?.length || records.some(record => !publicAddress(record.address))) return callback(Error('Metadata requires a public network destination.'));
    if (options.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  });
}

function metadataFetch(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !publicAddress(host)) throw Error('Metadata requires a public network destination.');
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: false, lookup: safeLookup, signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error(`Metadata provider returned HTTP ${response.statusCode}.`)); return; }
      const chunks = []; let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > 262144) { request.destroy(Error('Metadata is too large.')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => { if (!response.complete) return reject(Error('Incomplete metadata response.')); resolve(new Response(Buffer.concat(chunks), { status: 200 })); });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}
