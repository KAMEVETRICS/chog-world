import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function startLogin({ save, timeoutMs = 120000 }) {
  const state = randomBytes(32).toString('hex');
  let challenge, finished = false, requests = 0, timer, origin, resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // The caller may print/open the URL before awaiting completion.
  promise.catch(() => {});
  const close = () => { clearTimeout(timer); server.close(); server.closeAllConnections(); if (!finished) { finished = true; reject(Error('Local login cancelled.')); } };
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Invalid local Host.' });
      if (req.method === 'GET' && req.url === `/login/${state}`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'nonce-${state}'; style-src 'nonce-${state}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
        return res.end(loginPage(state));
      }
      if (req.method !== 'POST' || !['/challenge', '/verify'].includes(req.url)) return json(res, 404, { error: 'Not found.' });
      if (finished || req.headers.origin !== origin || !equal(req.headers['x-chog-state'], state)) return json(res, 403, { error: 'Invalid or completed local login.' });
      if (++requests > 20) return json(res, 429, { error: 'Too many login attempts.' });
      if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'Expected JSON.' });
      let size = 0, chunks = [];
      for await (const part of req) {
        size += part.length;
        if (size > 8192) { json(res, 413, { error: 'Request too large.' }); req.destroy(); return; }
        chunks.push(part);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/challenge') {
        const address = getAddress(body.address).toLowerCase();
        const nonce = randomBytes(32).toString('hex');
        const issued = Date.now(), expires = issued + Math.min(timeoutMs, 300000);
        const message = [
          `${new URL(origin).host} wants you to sign in with your Ethereum account:`, getAddress(address), '',
          'Sign in to the local Chog CLI. This proves wallet control for local persona import. It does not authorize transactions, transfers, approvals or hosted charges.', '',
          `URI: ${origin}`, 'Version: 1', 'Chain ID: 143', `Nonce: ${nonce}`, `Issued At: ${new Date(issued).toISOString()}`, `Expiration Time: ${new Date(expires).toISOString()}`, 'Resources:', '- chog-cli://local-persona'
        ].join('\n');
        challenge = { address, message, expires };
        return json(res, 200, { message });
      }
      if (!challenge || challenge.expires <= Date.now() || body.message !== challenge.message || typeof body.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) return json(res, 400, { error: 'Missing, expired or altered challenge.' });
      if (verifyMessage(body.message, body.signature).toLowerCase() !== challenge.address) return json(res, 400, { error: 'Signature does not match the wallet.' });
      const login = { address: challenge.address, chainId: 143, expiresAt: Date.now() + 3600000 };
      finished = true; challenge = undefined;
      try { await save(login); } catch { reject(Error('Could not save local wallet proof.')); close(); return; }
      res.once('finish', close);
      json(res, 200, { authenticated: true, address: login.address });
      resolve(login);
    } catch { if (!res.headersSent) json(res, 400, { error: 'Invalid login request.' }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  origin = `http://127.0.0.1:${server.address().port}`;
  timer = setTimeout(() => { finished = true; close(); reject(Error('Local login timed out. Run chog login again.')); }, timeoutMs);
  return { origin, state, url: `${origin}/login/${state}`, promise, close };
}

function loginPage(state) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local Chog login</title>
  <style nonce="${state}">body{font:16px system-ui;background:#f5efe3;color:#30261f;max-width:540px;margin:10vh auto;padding:24px}button,select{font:inherit;padding:12px;margin:8px 0;max-width:100%}button{background:#7d57cf;color:white;border:0;border-radius:8px}p{line-height:1.6}</style>
  <h1>Bring your Chog with you</h1><p>Sign a message to prove wallet control locally. Your wallet keys stay in your wallet. This sends no transaction and contacts no Chog World server.</p><select id="wallet" aria-label="Wallet"></select><br><button id="sign">Connect and sign</button><p id="status" role="status">Choose a wallet.</p>
  <script nonce="${state}">
  const choices=[], pick=document.getElementById('wallet'), button=document.getElementById('sign'), status=document.getElementById('status');
  function add(provider,name){if(!provider||choices.some(x=>x.provider===provider))return;choices.push({provider,name});const option=document.createElement('option');option.value=choices.length-1;option.textContent=name;pick.appendChild(option);}
  add(window.ethereum,'Browser wallet');
  window.addEventListener('eip6963:announceProvider',e=>add(e.detail.provider,e.detail.info.name));window.dispatchEvent(new Event('eip6963:requestProvider'));
  async function post(path,body){const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-chog-state':'${state}'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error||'Login failed');return data;}
  button.onclick=async()=>{button.disabled=true;try{const wallet=choices[Number(pick.value)];if(!wallet)throw Error('Open this page in a browser with an injected wallet.');const [address]=await wallet.provider.request({method:'eth_requestAccounts'});const {message}=await post('/challenge',{address});status.textContent='Review the local login message in your wallet.';const signature=await wallet.provider.request({method:'personal_sign',params:[message,address]});const result=await post('/verify',{message,signature});status.textContent='Signed in as '+result.address+'. Close this tab and return to your terminal.';}catch(e){status.textContent=e.message;button.disabled=false;}};
  </script></html>`;
}
