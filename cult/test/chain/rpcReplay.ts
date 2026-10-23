// Serves recorded JSON-RPC exchanges over real HTTP, so tests exercise HttpJsonRpc too. Requests are
// matched by method and parameters; anything unrecorded is answered with HTTP 500 and listed in `misses`.
import http from "node:http";
import type { AddressInfo } from "node:net";

export interface RecordedExchange {
  readonly request: { readonly method: string; readonly params: readonly unknown[] };
  readonly status: number;
  readonly body: unknown;
}

export const exchangeKey = (method: string, params: readonly unknown[]) => `${method} ${JSON.stringify(params)}`;

export class RpcReplayServer {
  readonly misses: string[] = [];
  readonly served: string[] = [];
  readonly #exchanges = new Map<string, RecordedExchange>();
  readonly #server = http.createServer((request, response) => this.#handle(request, response));

  constructor(exchanges: readonly RecordedExchange[]) {
    for (const exchange of exchanges) this.#exchanges.set(exchangeKey(exchange.request.method, exchange.request.params), exchange);
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}/rpc/secret-path?key=secret-query`;
  }

  async stop(): Promise<void> {
    this.#server.closeAllConnections();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: number; method: string; params: unknown[] };
      const key = exchangeKey(payload.method, payload.params);
      const exchange = this.#exchanges.get(key);
      if (!exchange) {
        this.misses.push(key);
        response.writeHead(500).end("unrecorded request");
        return;
      }
      this.served.push(key);
      const body = exchange.body && typeof exchange.body === "object" ? { ...exchange.body, id: payload.id } : exchange.body;
      response.writeHead(exchange.status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  }
}
