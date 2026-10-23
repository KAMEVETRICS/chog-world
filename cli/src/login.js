import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';

const equal = (a, b) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function startLogin({ save, discover, select, timeoutMs = 300000 }) {
  const state = randomBytes(32).toString('hex');
  let challenge, verified, chogs = [], busy = false, finished = false, requests = 0, timer, origin, resolve, reject;
  const controller = new AbortController();
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  // The caller may print/open the URL before awaiting completion.
  promise.catch(() => {});
  const close = () => { clearTimeout(timer); controller.abort(); server.close(); server.closeAllConnections(); if (!finished) { finished = true; reject(Error('Local login cancelled.')); } };
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  const complete = (res, login, selected = null) => { finished = true; res.once('finish', close); json(res, 200, { authenticated: true, address: login.address, requiresSelection: false, chogs, selected }); resolve({ ...login, selected }); };
  const discoverAndOffer = async res => {
    busy = true;
    chogs = discover ? await discover(verified.address, controller.signal) : [];
    controller.signal.throwIfAborted();
    const eligible = chogs.filter(chog => chog.awakened);
    if (eligible.length === 1 && select) {
      const selected = await select(eligible[0].tokenId, controller.signal);
      controller.signal.throwIfAborted();
      return complete(res, verified, selected);
    }
    if (eligible.length === 0) return complete(res, verified);
    busy = false;
    json(res, 200, { authenticated: true, address: verified.address, requiresSelection: true, chogs });
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, 403, { error: 'Invalid local Host.' });
      if (req.method === 'GET' && req.url === `/login/${state}`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'none'; script-src 'nonce-${state}'; style-src 'nonce-${state}'; img-src https://gateway.pinata.cloud; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
        return res.end(loginPage(state));
      }
      if (req.method !== 'POST' || !['/challenge', '/verify', '/select', '/discover'].includes(req.url)) return json(res, 404, { error: 'Not found.' });
      if (finished || req.headers.origin !== origin || !equal(req.headers['x-chog-state'], state)) return json(res, 403, { error: 'Invalid or completed local login.' });
      if (busy) return json(res, 403, { error: 'A login or selection is already in progress.' });
      if (++requests > 30) return json(res, 429, { error: 'Too many login attempts.' });
      if (req.headers['content-type'] !== 'application/json') return json(res, 415, { error: 'Expected JSON.' });
      let size = 0, chunks = [];
      for await (const part of req) {
        size += part.length;
        if (size > 8192) { json(res, 413, { error: 'Request too large.' }); req.destroy(); return; }
        chunks.push(part);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (finished || busy) return json(res, 403, { error: 'A login or selection is already in progress.' });
      if (req.url === '/discover') {
        if (!verified || !discover) return json(res, 403, { error: 'Sign in before finding your Chogs.' });
        return await discoverAndOffer(res);
      }
      if (req.url === '/select') {
        const found = chogs.find(chog => chog.tokenId === body.tokenId && chog.awakened);
        if (!verified || !found || !select) return json(res, 403, { error: 'Choose an awakened Chog from this wallet.' });
        busy = true;
        const selected = await select(found.tokenId, controller.signal);
        controller.signal.throwIfAborted();
        return complete(res, verified, selected);
      }
      if (verified) return json(res, 403, { error: 'Wallet already verified. Choose your Chog below.' });
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
      busy = true; challenge = undefined;
      await save(login);
      verified = login;
      await discoverAndOffer(res);
    } catch (error) { busy = false; if (!res.headersSent && !res.destroyed) json(res, 400, { error: error instanceof Error ? error.message : 'Invalid login request.', ...(verified ? { chogs, requiresSelection: true, canRetryDiscovery: Boolean(discover) } : {}) }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  origin = `http://127.0.0.1:${server.address().port}`;
  timer = setTimeout(() => { finished = true; close(); reject(Error('Local login timed out. Run chog login again.')); }, timeoutMs);
  return { origin, state, url: `${origin}/login/${state}`, promise, close };
}

function loginPage(state) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local Chog login</title>
  <style nonce="${state}">body{font:16px system-ui;background:#f5efe3;color:#30261f;max-width:540px;margin:8vh auto;padding:24px}button,select{font:inherit;padding:12px;margin:8px 0;max-width:100%}button{background:#7d57cf;color:white;border:0;border-radius:8px;cursor:pointer}button:disabled{opacity:.55;cursor:default}button:focus-visible,select:focus-visible{outline:3px solid #30261f;outline-offset:3px}p{line-height:1.6}.chogs{display:grid;gap:12px;margin-top:20px}.chog{display:flex;align-items:center;gap:16px;padding:12px;border:1px solid #d7cbbb;border-radius:12px;background:#fffaf2}.chog img{width:76px;height:76px;object-fit:cover;border-radius:8px}.chog div{flex:1}.chog strong{display:block}.chog small{display:block;margin-top:6px;color:#6f6258}</style>
  <h1>Bring your Chog with you</h1><p>Connect your wallet, sign in, then choose your Chog. We find the Chogs in your wallet automatically. Your keys stay in your wallet.</p><div id="wallet-step"><select id="wallet" aria-label="Wallet"></select><br><button id="sign">Connect and sign</button></div><p id="status" role="status">Choose a wallet.</p><button id="retry" hidden>Retry finding Chogs</button><section id="chogs" class="chogs" aria-label="Your Chogs"></section>
  <script nonce="${state}">
  const choices=[], pick=document.getElementById('wallet'), button=document.getElementById('sign'), status=document.getElementById('status'), chogs=document.getElementById('chogs'), walletStep=document.getElementById('wallet-step'), retry=document.getElementById('retry');
  function add(provider,name){if(!provider||choices.some(x=>x.provider===provider))return;choices.push({provider,name});const option=document.createElement('option');option.value=choices.length-1;option.textContent=name;pick.appendChild(option);}
  add(window.ethereum,'Browser wallet');
  window.addEventListener('eip6963:announceProvider',e=>add(e.detail.provider,e.detail.info.name));window.dispatchEvent(new Event('eip6963:requestProvider'));
  async function post(path,body){const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json','x-chog-state':'${state}'},body:JSON.stringify(body)});const data=await res.json();if(!res.ok){const error=Error(data.error||'Login failed');error.chogs=data.chogs;error.canRetryDiscovery=data.canRetryDiscovery;throw error;}return data;}
  function failure(error){status.textContent=error.message;if(error.canRetryDiscovery){walletStep.hidden=true;retry.hidden=false;retry.disabled=false;render(error.chogs||[]);}else button.disabled=false;}
  retry.onclick=async()=>{retry.disabled=true;status.textContent='Finding your Chogs on Monad…';try{show(await post('/discover',{}));}catch(error){failure(error);}};
  function show(result){retry.hidden=true;walletStep.hidden=true;if(result.selected){chogs.replaceChildren();status.textContent=result.selected.name+' is ready. Close this tab and return to your terminal.';}else if(result.requiresSelection){status.textContent='Choose which Chog your assistant should use.';render(result.chogs);}else{status.textContent=result.chogs.length?'Your Chogs need awakening before they can be used as agents. Awaken one, then run login again.':'This wallet does not hold any Chog Genesis NFTs.';render(result.chogs);}}
  function render(owned){chogs.replaceChildren();for(const chog of owned){const card=document.createElement('article');card.className='chog';if(chog.image){const img=document.createElement('img');img.src=chog.image;img.alt=chog.name;card.appendChild(img);}const info=document.createElement('div'),name=document.createElement('strong'),hint=document.createElement('small'),use=document.createElement('button');name.textContent=chog.name;hint.textContent=chog.awakened?'Awakened agent':'Not awakened yet';info.append(name,hint);use.textContent='Use this Chog';use.disabled=!chog.awakened;use.onclick=async()=>{for(const b of chogs.querySelectorAll('button'))b.disabled=true;status.textContent='Loading your Chog persona…';try{show(await post('/select',{tokenId:chog.tokenId}));}catch(e){failure(e);}};card.append(info,use);chogs.appendChild(card);}}
  button.onclick=async()=>{button.disabled=true;try{const wallet=choices[Number(pick.value)];if(!wallet)throw Error('Open this page in a browser with an injected wallet.');const [address]=await wallet.provider.request({method:'eth_requestAccounts'});const {message}=await post('/challenge',{address});status.textContent='Review the local login message in your wallet.';const signature=await wallet.provider.request({method:'personal_sign',params:[message,address]});status.textContent='Finding your Chogs on Monad…';show(await post('/verify',{message,signature}));}catch(e){failure(e);}};
  </script></html>`;
}
