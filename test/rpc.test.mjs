import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { openRpc, openRpcWithFallback } from "../scripts/rpc.mjs";

async function endpoint(t, handler) {
  const sockets = new Set();
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    handler(JSON.parse(body), response);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => { for (const socket of sockets) socket.destroy(); server.close(); });
  return { url: `http://127.0.0.1:${server.address().port}`, sockets };
}

function reply(response, payload, result) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }));
}

test("RPC timeout closes the active HTTP connection instead of leaving the CLI alive", async (t) => {
  let received = false;
  const server = await endpoint(t, () => { received = true; });
  await assert.rejects(openRpc(server.url, { expectedChainId: 10143, timeoutMs: 100 }), /timeout|timed out/i);
  assert.equal(received, true, "the simulated RPC must actually receive the request");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(server.sockets.size, 0, "timed-out requests must destroy their sockets");
});

test("RPC validates the actual chain before using a static provider", async (t) => {
  const server = await endpoint(t, (payload, response) => reply(response, payload, "0x8f"));
  await assert.rejects(openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 }), /expected 10143.*143/);
});

test("verified RPC connection performs reads without repeated network detection", async (t) => {
  let probes = 0;
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") probes++;
    reply(response, payload, payload.method === "eth_chainId" ? "0x279f" : "0x2a");
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 });
  t.after(() => rpc.close());
  assert.equal(await rpc.provider.getBlockNumber(), 42);
  assert.equal(probes, 1);
});

test("RPC reuses one connection across the chain probe and sequential reads", async (t) => {
  const connections = new Set();
  const server = await endpoint(t, (payload, response) => {
    connections.add(response.socket);
    reply(response, payload, payload.method === "eth_chainId" ? "0x279f" : "0x2a");
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 });
  t.after(() => rpc.close());
  assert.equal(await rpc.provider.getBlockNumber(), 42);
  assert.equal(await rpc.provider.getBlockNumber(), 42);
  assert.equal(connections.size, 1, "sequential requests must reuse the verified connection");
});

test("closing RPC destroys its idle keep-alive connection", async (t) => {
  const server = await endpoint(t, (payload, response) => reply(response, payload, "0x279f"));
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 });
  t.after(() => rpc.close());
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(server.sockets.size, 1, "the verified connection must remain available for reuse");
  rpc.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.sockets.size, 0);
});

test("queued RPC reads still respect their deadline with one active connection", async (t) => {
  let activeReadStarted;
  const started = new Promise((resolve) => { activeReadStarted = resolve; });
  let activeReadTime;
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else if (payload.method === "eth_blockNumber") {
      activeReadTime = Date.now();
      activeReadStarted();
    } else {
      assert.ok(Date.now() - activeReadTime >= 100, "another read must wait for the active connection");
    }
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 150 });
  t.after(() => rpc.close());
  const active = assert.rejects(rpc.provider.getBlockNumber(), /timed out/);
  await started;
  const queuedAt = Date.now();
  const queued = assert.rejects(rpc.provider.getBalance("0x0000000000000000000000000000000000000001"), /timed out/);
  await Promise.all([active, queued]);
  assert.ok(Date.now() - queuedAt < 500, "queueing must not add an unbounded wait before the deadline");
});

test("RPC deadline also closes a response that keeps trickling bytes", async (t) => {
  let interval;
  const server = await endpoint(t, (_payload, response) => {
    response.setHeader("content-type", "application/json");
    response.write(" ");
    interval = setInterval(() => response.write(" "), 20);
  });
  t.after(() => clearInterval(interval));
  const started = Date.now();
  await assert.rejects(openRpc(server.url, { expectedChainId: 10143, timeoutMs: 100 }), /timed out/i);
  assert.ok(Date.now() - started < 1000, "the deadline must not reset for incoming bytes");
});

test("RPC errors and redirects are not automatically retried", async (t) => {
  for (const status of [302, 429, 503]) {
    let requests = 0;
    const server = await endpoint(t, (_payload, response) => {
      requests++;
      response.writeHead(status, { location: "/redirect-target" });
      response.end();
    });
    await assert.rejects(openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 }), new RegExp(`HTTP ${status}`));
    assert.equal(requests, 1);
  }
});

test("closing an RPC connection aborts an active provider read", async (t) => {
  let readStarted;
  const started = new Promise((resolve) => { readStarted = resolve; });
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else readStarted();
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 1000 });
  const reading = rpc.provider.getBlockNumber();
  const rejected = assert.rejects(reading);
  await started;
  rpc.close();
  await rejected;
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.sockets.size, 0);
});

test("closing RPC also destroys a socket allocated later for a queued read", async (t) => {
  let readStarted;
  const started = new Promise((resolve) => { readStarted = resolve; });
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else readStarted();
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 1000 });
  t.after(() => rpc.close());
  const active = rpc.provider.getBlockNumber();
  await started;
  const queued = rpc.provider.getBalance("0x0000000000000000000000000000000000000001");
  const finished = Promise.allSettled([active, queued]);
  await new Promise((resolve) => setTimeout(resolve, 25));
  rpc.close();
  assert.ok((await finished).every((result) => result.status === "rejected"));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(server.sockets.size, 0, "the agent must not retain a replacement socket for a cancelled queued read");
});

test("RPC rejects malformed chain-ID envelopes", async (t) => {
  for (const result of [null, { result: "0x279f" }, { jsonrpc: "2.0", id: 99, result: "0x279f" }]) {
    const server = await endpoint(t, (_payload, response) => {
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(result));
    });
    await assert.rejects(async () => {
      const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 });
      rpc.close();
    }, /invalid chain-ID response/);
  }
});

test("RPC rejects plaintext URL credentials before opening a connection", async (t) => {
  let requests = 0;
  const server = await endpoint(t, (payload, response) => { requests++; reply(response, payload, "0x279f"); });
  await assert.rejects(async () => {
    const rpc = await openRpc(server.url.replace("http://", "http://sample-user:sample-password@"), { expectedChainId: 10143, timeoutMs: 500 });
    rpc.close();
  }, /credentials require HTTPS/);
  assert.equal(requests, 0);
});

test("RPC bounds both compressed and uncompressed response allocation", async (t) => {
  for (const compressed of [false, true]) {
    const server = await endpoint(t, (payload, response) => {
      const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: payload.id, result: "0x279f", padding: "x".repeat(5 * 1024 * 1024) }));
      response.on("error", () => {});
      if (compressed) response.setHeader("content-encoding", "gzip");
      response.end(compressed ? gzipSync(body) : body);
    });
    await assert.rejects(async () => {
      const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 1000 });
      rpc.close();
    }, /response.*(large|invalid)/i);
  }
});

test("connection setup tries an alternate endpoint before returning a provider", async (t) => {
  const { openRpcWithFallback } = await import("../scripts/rpc.mjs");
  const failed = await endpoint(t, (_payload, response) => { response.writeHead(503); response.end(); });
  const healthy = await endpoint(t, (payload, response) => reply(response, payload, payload.method === "eth_chainId" ? "0x279f" : "0x2a"));
  const rpc = await openRpcWithFallback([failed.url, healthy.url], { expectedChainId: 10143, timeoutMs: 500 });
  t.after(() => rpc.close());
  assert.equal(await rpc.provider.getBlockNumber(), 42);
});

test("a wrong-chain response fails closed instead of selecting another endpoint", async (t) => {
  const { openRpcWithFallback } = await import("../scripts/rpc.mjs");
  const wrong = await endpoint(t, (payload, response) => reply(response, payload, "0x8f"));
  let fallbackRequests = 0;
  const healthy = await endpoint(t, (payload, response) => { fallbackRequests++; reply(response, payload, "0x279f"); });
  await assert.rejects(openRpcWithFallback([wrong.url, healthy.url], { expectedChainId: 10143, timeoutMs: 500 }), /expected 10143.*143/);
  assert.equal(fallbackRequests, 0);
});

test("RPC selection completes unsigned preflight and closes a provider that returns HTTP 400", async (t) => {
  const failed = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else { response.writeHead(400); response.end(); }
  });
  const healthy = await endpoint(t, (payload, response) => reply(response, payload, payload.method === "eth_chainId" ? "0x279f" : "0x2a"));
  let failedProvider;
  const rpc = await openRpcWithFallback([failed.url, healthy.url], {
    expectedChainId: 10143, timeoutMs: 500,
    async preflight(provider) {
      failedProvider ??= provider;
      return { block: await provider.getBlockNumber() };
    },
  });
  t.after(() => rpc.close());
  assert.deepEqual(rpc.preflight, { block: 42 });
  assert.equal(failedProvider.destroyed, true, "a rejected endpoint must be closed before selection continues");
});

test("RPC selection closes a timed-out preflight before trying the next endpoint", async (t) => {
  const failed = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
  });
  const healthy = await endpoint(t, (payload, response) => reply(response, payload, payload.method === "eth_chainId" ? "0x279f" : "0x2a"));
  let failedProvider;
  const rpc = await openRpcWithFallback([failed.url, healthy.url], {
    expectedChainId: 10143, timeoutMs: 100,
    async preflight(provider) {
      failedProvider ??= provider;
      return await provider.getBlockNumber();
    },
  });
  t.after(() => rpc.close());
  assert.equal(rpc.preflight, 42);
  assert.equal(failedProvider.destroyed, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(failed.sockets.size, 0, "failed preflight must not leave active connections");
});

test("a fatal preflight rejection stops endpoint selection and closes its provider", async (t) => {
  for (const code of ["RPC_CHAIN_MISMATCH", "PREFLIGHT_REJECTED"]) {
    const first = await endpoint(t, (payload, response) => reply(response, payload, "0x279f"));
    let fallbackRequests = 0;
    const healthy = await endpoint(t, (payload, response) => { fallbackRequests++; reply(response, payload, "0x279f"); });
    let rejectedProvider;
    const failure = Object.assign(new Error("Preflight was rejected."), { code });
    await assert.rejects(openRpcWithFallback([first.url, healthy.url], {
      expectedChainId: 10143, timeoutMs: 500,
      async preflight(provider) { rejectedProvider = provider; throw failure; },
    }), (error) => error === failure);
    assert.equal(rejectedProvider.destroyed, true);
    assert.equal(fallbackRequests, 0);
  }
});

test("HTTP errors name a validated RPC method without exposing request parameters", async (t) => {
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else { response.writeHead(400); response.end(); }
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500 });
  t.after(() => rpc.close());
  await assert.rejects(rpc.provider.send("eth_getBalance", ["private-parameter", "latest"]), (error) => {
    assert.match(error.message, /eth_getBalance.*HTTP 400/);
    assert.equal(error.rpcMethod, "eth_getBalance");
    assert.doesNotMatch(error.message, /private-parameter/);
    return true;
  });
  await assert.rejects(rpc.provider.send("private?token=sample-secret", []), (error) => {
    assert.match(error.message, /HTTP 400/);
    assert.doesNotMatch(error.message, /private|sample-secret/);
    assert.equal(error.rpcMethod, undefined);
    return true;
  });
});

test("exhausted preflight endpoints report that unsigned preflight failed", async (t) => {
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") reply(response, payload, "0x279f");
    else { response.writeHead(400); response.end(); }
  });
  await assert.rejects(openRpcWithFallback([server.url], {
    expectedChainId: 10143, timeoutMs: 500,
    async preflight(provider) { await provider.getBlockNumber(); },
  }), /unsigned preflight failed.*127\.0\.0\.1 eth_blockNumber/i);
});

test("deployment broadcast and receipt wait never depend on eth_blockNumber", async (t) => {
  const { Transaction, Wallet } = await import("ethers");
  // Public Hardhat test mnemonic, signing offline for a simulated endpoint only.
  const wallet = Wallet.fromPhrase("test test test test test test test test test test test junk");
  const signed = await wallet.signTransaction({ chainId: 10143n, nonce: 2, gasLimit: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, to: wallet.address, type: 2 });
  const hash = Transaction.from(signed).hash;
  const calls = [];
  const server = await endpoint(t, (payload, response) => {
    calls.push(payload.method);
    // Reproduces monad-testnet.drpc.org intermittently rejecting eth_blockNumber with HTTP 400 / -32601.
    const unavailable = () => { response.statusCode = 400; response.end(JSON.stringify({ jsonrpc: "2.0", id: payload.id, error: { code: -32601, message: "the method does not exist/is not available" } })); };
    if (payload.method === "eth_chainId") return reply(response, payload, "0x279f");
    if (payload.method === "eth_blockNumber") return unavailable();
    if (payload.method === "eth_sendRawTransaction") return reply(response, payload, hash);
    if (payload.method === "eth_getTransactionReceipt") {
      const attempt = calls.filter((method) => method === "eth_getTransactionReceipt").length;
      if (attempt === 1) return unavailable();
      if (attempt === 2) return reply(response, payload, null);
      return reply(response, payload, { transactionHash: hash, status: "0x1", blockNumber: "0x7", contractAddress: null });
    }
    unavailable();
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500, receiptPollMs: 10 });
  t.after(() => rpc.close());
  const transaction = await rpc.provider.broadcastTransaction(signed);
  assert.equal(transaction.hash, hash);
  const receipt = await transaction.wait(1, 2000);
  assert.equal(receipt.blockNumber, 7);
  assert.equal(calls.filter((method) => method === "eth_sendRawTransaction").length, 1, "a broadcast is never retried");
  assert.equal(calls.includes("eth_blockNumber"), false);
});

test("deployment receipt wait reports a reverted transaction and a timeout with its hash", async (t) => {
  const { Transaction, Wallet } = await import("ethers");
  const wallet = Wallet.fromPhrase("test test test test test test test test test test test junk");
  const sign = (nonce) => wallet.signTransaction({ chainId: 10143n, nonce, gasLimit: 21000n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, to: wallet.address, type: 2 });
  const reverted = await sign(0);
  const unseen = await sign(1);
  const server = await endpoint(t, (payload, response) => {
    if (payload.method === "eth_chainId") return reply(response, payload, "0x279f");
    if (payload.method === "eth_sendRawTransaction") return reply(response, payload, Transaction.from(payload.params[0]).hash);
    const isReverted = payload.params[0] === Transaction.from(reverted).hash;
    reply(response, payload, isReverted ? { status: "0x0", blockNumber: "0x9" } : null);
  });
  const rpc = await openRpc(server.url, { expectedChainId: 10143, timeoutMs: 500, receiptPollMs: 10 });
  t.after(() => rpc.close());
  await assert.rejects((await rpc.provider.broadcastTransaction(reverted)).wait(1, 1000), /reverted in block 9/);
  const pending = await rpc.provider.broadcastTransaction(unseen);
  await assert.rejects(pending.wait(1, 100), new RegExp(`${pending.hash}.*not retried`));
});
