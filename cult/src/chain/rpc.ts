// Owned JSON-RPC transport for chain reads, after ../scripts/rpc.mjs: keep-alive sockets this process
// owns, a hard deadline per request (queueing included), bounded responses, no retries or redirects, and
// errors that name only the host and method. The URL path and query (where providers put API keys),
// request parameters and headers never appear in an error.
import http from "node:http";
import https from "node:https";

export type RpcFailure = "transport" | "error_response" | "reverted";

export class RpcError extends Error {
  override readonly name = "RpcError";
  constructor(
    message: string,
    readonly failure: RpcFailure,
    readonly method: string,
    /** JSON-RPC error code, when the node answered with an error object. */
    readonly code?: number,
    /** Revert data (hex), when the call reverted. */
    readonly data?: string,
  ) {
    super(message);
  }
}

export interface JsonRpc {
  /** Host only, for logs. */
  readonly host: string;
  /** Sends one request. Rejects with RpcError; never retries. */
  request(method: string, params: readonly unknown[]): Promise<unknown>;
  close(): void;
}

export interface HttpJsonRpcOptions {
  readonly url: string;
  /** Whole-request deadline, including time spent waiting for a socket. */
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Parallel connections. Ownership checks for many Chogs run in parallel. */
  readonly maxSockets?: number;
}

const METHOD = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const HEX = /^0x[0-9a-fA-F]*$/;

/** A short, printable excerpt of a node's error message. It never contains our URL or parameters. */
function excerpt(message: unknown): string {
  return typeof message === "string" ? message.replace(/[^\x20-\x7e]/g, "?").slice(0, 160) : "";
}

function revertData(error: { data?: unknown }): string | undefined {
  const data = error.data;
  if (typeof data === "string" && HEX.test(data)) return data;
  // Some nodes nest it: { data: { data: "0x…" } }.
  const nested = (data as { data?: unknown } | null | undefined)?.data;
  return typeof nested === "string" && HEX.test(nested) ? nested : undefined;
}

export class HttpJsonRpc implements JsonRpc {
  readonly host: string;
  readonly #target: URL;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #agent: http.Agent;
  readonly #active = new Set<http.ClientRequest>();
  #closed = false;
  #nextId = 1;

  constructor(options: HttpJsonRpcOptions) {
    let target: URL;
    try { target = new URL(options.url); } catch { throw new Error("The RPC URL is not a valid URL."); }
    if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("The RPC URL must use HTTP(S).");
    if (target.protocol === "http:" && (target.username || target.password)) throw new Error("RPC credentials require HTTPS.");
    this.#target = target;
    this.host = target.hostname;
    this.#timeoutMs = options.timeoutMs ?? 5_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
    const agentOptions = { keepAlive: true, maxSockets: options.maxSockets ?? 8 };
    this.#agent = target.protocol === "https:" ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
    // Node can hand a queued request a socket after close(); destroy it instead of keeping it alive.
    this.#agent.on("free", (socket: { destroy(): void }) => { if (this.#closed) socket.destroy(); });
  }

  request(method: string, params: readonly unknown[]): Promise<unknown> {
    const label = METHOD.test(method) ? method : "request";
    const fail = (message: string) => new RpcError(`RPC ${this.host} ${label} ${message}`, "transport", label);
    if (this.#closed) return Promise.reject(fail("not sent: the connection is closed."));
    const id = this.#nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        this.#active.delete(request);
        if (error) { request.destroy(); reject(error); } else resolve(result);
      };
      const transport = this.#target.protocol === "https:" ? https : http;
      const request = transport.request(this.#target, {
        method: "POST", agent: this.#agent,
        headers: { "content-type": "application/json", accept: "application/json", "accept-encoding": "identity", "content-length": Buffer.byteLength(body) },
      }, (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > this.#maxResponseBytes) finish(fail(`response exceeded ${this.#maxResponseBytes} bytes; the connection was closed.`));
          else chunks.push(chunk);
        });
        response.on("error", () => finish(fail("response failed.")));
        response.on("aborted", () => finish(fail("response was interrupted.")));
        response.on("end", () => {
          if (settled) return;
          if (status < 200 || status >= 300) {
            // Some providers send a JSON-RPC error with a non-2xx status (for example eth_getLogs range limits).
            let detail = "";
            try { detail = excerpt((JSON.parse(Buffer.concat(chunks).toString("utf8")) as { error?: { message?: unknown } }).error?.message); } catch { /* not JSON */ }
            finish(fail(`returned HTTP ${status}${detail ? ` (${detail})` : ""}; not retried.`));
            return;
          }
          let payload: { jsonrpc?: unknown; id?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
          try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { finish(fail("returned a response that is not JSON.")); return; }
          if (!payload || typeof payload !== "object" || Array.isArray(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
            finish(fail("returned a malformed JSON-RPC response."));
            return;
          }
          if (payload.error !== undefined) {
            const error = payload.error ?? {};
            const code = typeof error.code === "number" ? error.code : undefined;
            const message = excerpt(error.message);
            const data = revertData(error);
            const reverted = code === 3 || /revert/i.test(message);
            finish(new RpcError(`RPC ${this.host} ${label} ${reverted ? "reverted" : "returned an error"}${code === undefined ? "" : ` ${code}`}${message ? `: ${message}` : ""}`,
              reverted ? "reverted" : "error_response", label, code, reverted ? data ?? "0x" : undefined));
            return;
          }
          if (!("result" in payload)) { finish(fail("returned a response without a result.")); return; }
          finish(null, payload.result);
        });
      });
      this.#active.add(request);
      request.on("error", (error: NodeJS.ErrnoException) => finish(fail(`failed (${error.code ?? "connection error"}).`)));
      const deadline = setTimeout(() => finish(fail(`timed out after ${this.#timeoutMs}ms; the connection was closed.`)), this.#timeoutMs);
      request.end(body);
    });
  }

  close(): void {
    this.#closed = true;
    for (const request of this.#active) request.destroy(new Error("RPC connection closed."));
    this.#agent.destroy();
  }
}
