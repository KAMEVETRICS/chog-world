import { FetchRequest, JsonRpcProvider, Transaction } from "ethers";
import http from "node:http";
import https from "node:https";
import { gunzipSync } from "node:zlib";

function boundedTransport(timeoutMs) {
  const maxResponseBytes = 4 * 1024 * 1024;
  const active = new Set();
  const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 1 });
  let closed = false;
  for (const agent of [httpAgent, httpsAgent]) {
    // Node can allocate a queued request's socket after Agent.destroy().
    // The cancelled request releases that socket through the agent's free event.
    agent.on("free", (socket) => { if (closed) socket.destroy(); });
  }
  const getUrl = (req, signal) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error("RPC connection is closed.")); return; }
    const target = new URL(req.url);
    if (!["http:", "https:"].includes(target.protocol)) { reject(new Error("RPC URL must use HTTP(S).")); return; }
    if (target.protocol === "http:" && (req.credentials || target.username || target.password) && !req.allowInsecureAuthentication) {
      reject(new Error("RPC credentials require HTTPS.")); return;
    }
    let methodLabel = "";
    try {
      const payload = JSON.parse(Buffer.from(req.body ?? []).toString("utf8"));
      if (typeof payload?.method === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(payload.method)) methodLabel = ` ${payload.method}`;
    } catch { /* Diagnostics must never expose request parameters or headers. */ }
    let settled = false;
    let deadline;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      active.delete(request);
      if (error) {
        if (methodLabel) error.rpcMethod = methodLabel.slice(1);
        request.destroy();
        reject(error);
      }
      else resolve(result);
    };
    const request = (target.protocol === "https:" ? https : http).request(target, {
      method: req.method, headers: req.headers, agent: target.protocol === "https:" ? httpsAgent : httpAgent,
    }, (response) => {
      const statusCode = response.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        finish(new Error(`RPC ${target.hostname}${methodLabel} returned HTTP ${statusCode}; requests are not retried or redirected.`));
        return;
      }
      const chunks = [];
      let responseBytes = 0;
      response.on("data", (chunk) => {
        responseBytes += chunk.length;
        if (responseBytes > maxResponseBytes) finish(new Error(`RPC response is too large on ${target.hostname}.`));
        else if (!settled) chunks.push(chunk);
      });
      response.on("error", () => finish(new Error(`RPC response failed on ${target.hostname}.`)));
      response.on("aborted", () => finish(new Error(`RPC response was interrupted on ${target.hostname}.`)));
      response.on("end", () => {
        try {
          let body = Buffer.concat(chunks);
          if (response.headers["content-encoding"] === "gzip") body = gunzipSync(body, { maxOutputLength: maxResponseBytes });
          const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value ?? ""]));
          finish(null, { statusCode, statusMessage: response.statusMessage ?? "", headers, body });
        } catch (error) {
          finish(new Error(error.code === "ERR_BUFFER_TOO_LARGE"
            ? `RPC response is too large on ${target.hostname}.`
            : `RPC returned an invalid response on ${target.hostname}.`));
        }
      });
    });
    active.add(request);
    request.on("error", (error) => finish(new Error(`RPC request failed on ${target.hostname} (${error.code ?? "connection error"}).`)));
    const deadlineMs = Math.min(timeoutMs, req.timeout);
    deadline = setTimeout(() => finish(new Error(`RPC ${target.hostname} timed out after ${deadlineMs}ms; the connection was closed.`)), deadlineMs);
    signal?.addListener(() => finish(new Error("RPC request cancelled; the connection was closed.")));
    if (signal?.cancelled) { finish(new Error("RPC request cancelled.")); return; }
    if (req.body) request.write(req.body);
    request.end();
  });
  return {
    getUrl,
    close() {
      closed = true;
      for (const request of active) request.destroy(new Error("RPC connection closed."));
      httpAgent.destroy();
      httpsAgent.destroy();
    },
  };
}

// ethers' broadcastTransaction and wait() also call eth_blockNumber, which monad-testnet.drpc.org
// intermittently rejects with HTTP 400 (-32601). Deployment only needs these two methods.
class DeploymentProvider extends JsonRpcProvider {
  #receiptPollMs;

  constructor(request, chainId, options, receiptPollMs) {
    super(request, chainId, options);
    this.#receiptPollMs = receiptPollMs;
  }

  async broadcastTransaction(signedTransaction) {
    const { hash } = Transaction.from(signedTransaction);
    const returned = await this.send("eth_sendRawTransaction", [signedTransaction]);
    if (typeof returned !== "string" || returned.toLowerCase() !== hash) throw new Error(`RPC returned a different hash for broadcast ${hash}.`);
    return { hash, wait: (confirms = 1, timeoutMs = 120_000) => this.#waitForReceipt(hash, confirms, timeoutMs) };
  }

  async #waitForReceipt(hash, confirms, timeoutMs) {
    if (confirms !== 1) throw new Error("Deployment receipts support exactly one confirmation.");
    const deadline = Date.now() + timeoutMs;
    let lastError = "";
    while (Date.now() < deadline) {
      try {
        const receipt = await this.send("eth_getTransactionReceipt", [hash]);
        if (receipt) {
          const blockNumber = Number(BigInt(receipt.blockNumber));
          if (BigInt(receipt.status) !== 1n) throw Object.assign(new Error(`Transaction ${hash} reverted in block ${blockNumber}.`), { code: "TRANSACTION_REVERTED" });
          return { hash, blockNumber, contractAddress: receipt.contractAddress ?? null, status: 1 };
        }
      } catch (error) {
        if (error.code === "TRANSACTION_REVERTED") throw error;
        // The transaction is already broadcast; a failed receipt read is only retried as a read.
        lastError = ` Last receipt read error: ${error.shortMessage ?? error.message}`;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.#receiptPollMs, Math.max(0, deadline - Date.now()))));
    }
    throw new Error(`No receipt for broadcast ${hash} within ${timeoutMs}ms; it was not retried, reconcile it before deploying again.${lastError}`);
  }
}

export async function openRpc(url, { expectedChainId, timeoutMs = 10_000, probeTimeoutMs = timeoutMs, receiptPollMs = 2000 } = {}) {
  const transport = boundedTransport(timeoutMs);
  const request = new FetchRequest(url);
  request.timeout = timeoutMs;
  request.getUrlFunc = transport.getUrl;
  request.retryFunc = async () => false;
  request.setThrottleParams({ maxAttempts: 1 });
  try {
    const probe = request.clone();
    probe.timeout = Math.min(timeoutMs, probeTimeoutMs);
    probe.body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
    probe.setHeader("content-type", "application/json");
    const result = (await probe.send()).bodyJson;
    if (!result || Array.isArray(result) || result.jsonrpc !== "2.0" || result.id !== 1 || "error" in result || typeof result.result !== "string" || !/^0x[0-9a-f]+$/i.test(result.result)) throw new Error("RPC returned an invalid chain-ID response.");
    const actualChainId = BigInt(result.result);
    if (actualChainId !== BigInt(expectedChainId)) {
      const error = new Error(`RPC chain mismatch: expected ${expectedChainId}, received ${actualChainId}.`);
      error.code = "RPC_CHAIN_MISMATCH";
      throw error;
    }
    const provider = new DeploymentProvider(request, expectedChainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 }, receiptPollMs);
    return { provider, close() { provider.destroy(); transport.close(); } };
  } catch (error) { transport.close(); throw error; }
}

export async function openRpcWithFallback(urls, options) {
  const { preflight, ...rpcOptions } = options;
  const failures = [];
  for (const url of new Set(urls)) {
    let rpc;
    try {
      rpc = await openRpc(url, { ...rpcOptions, probeTimeoutMs: Math.min(options.timeoutMs ?? 10_000, 5000) });
      // Endpoint fallback ends before the caller signs or broadcasts a transaction.
      const result = preflight ? await preflight(rpc.provider) : undefined;
      return { ...rpc, rpcHost: new URL(url).hostname, ...(preflight ? { preflight: result } : {}) };
    } catch (error) {
      rpc?.close();
      if (error.code === "RPC_CHAIN_MISMATCH" || error.code === "PREFLIGHT_REJECTED") throw error;
      const method = typeof error.rpcMethod === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.rpcMethod) ? ` ${error.rpcMethod}` : "";
      failures.push(`${new URL(url).hostname}${method}`);
    }
  }
  if (preflight) throw new Error(`RPC setup or unsigned preflight failed for chain ${options.expectedChainId} (${failures.join(", ")}). All connections were closed; no transaction was sent during setup or preflight.`);
  throw new Error(`Could not connect to a verified chain ${options.expectedChainId} RPC (${failures.join(", ")}). All connections were closed; no transaction was sent during connection setup.`);
}
