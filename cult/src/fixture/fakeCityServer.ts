import http from "node:http";
import type { AddressInfo } from "node:net";
import type { CityEvent, CityTickData } from "../city/contract.js";

/**
 * A stand-in for Chog City's GET /api/city/events, following the City plan: CityEvent envelopes as SSE,
 * resume after ?after= or Last-Event-ID, `reset` outside the replay window, comment heartbeats.
 * Local tests and demos only.
 */
export class FakeCityServer {
  readonly #events: CityEvent[] = [];
  readonly #clients = new Set<http.ServerResponse>();
  readonly #retention: number;
  readonly #heartbeatMs: number;
  #server: http.Server | undefined;
  #port = 0;
  #heartbeat: NodeJS.Timeout | undefined;

  constructor(options: { retention?: number; heartbeatMs?: number } = {}) {
    this.#retention = options.retention ?? 10_000;
    this.#heartbeatMs = options.heartbeatMs ?? 15_000;
  }

  get url(): string { return `http://127.0.0.1:${this.#port}`; }
  get revision(): string { return String(this.#events.length); }

  /** Starts listening; after a restart it reuses the same port and event history. */
  async start(): Promise<void> {
    this.#server = http.createServer((request, response) => this.#handle(request, response));
    await new Promise<void>((resolve, reject) => { this.#server!.once("error", reject); this.#server!.listen(this.#port, "127.0.0.1", resolve); });
    this.#port = (this.#server.address() as AddressInfo).port;
    this.#heartbeat = setInterval(() => { for (const client of this.#clients) client.write(": ping\n\n"); }, this.#heartbeatMs);
  }

  /** Simulates City going down: closes every stream and stops accepting connections. */
  async stop(): Promise<void> {
    clearInterval(this.#heartbeat);
    for (const client of this.#clients) client.destroy();
    this.#clients.clear();
    await new Promise<void>((resolve) => (this.#server ? this.#server.close(() => resolve()) : resolve()));
    this.#server = undefined;
  }

  publish(type: string, data: unknown, createdAtMs: number): CityEvent {
    const event: CityEvent = { revision: String(this.#events.length + 1), type, data, createdAt: new Date(createdAtMs).toISOString() };
    this.#events.push(event);
    for (const client of this.#clients) client.write(this.#frame(event));
    return event;
  }

  publishTick(activities: CityTickData["activities"], createdAtMs: number): CityEvent {
    return this.publish("city_tick", { tick: String(this.#events.length + 1), activities } satisfies CityTickData, createdAtMs);
  }

  #frame(event: CityEvent): string {
    return `id: ${event.revision}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  #handle(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/city/events") { response.writeHead(404).end(); return; }
    const header = request.headers["last-event-id"];
    const cursorText = typeof header === "string" && header !== "" ? header : url.searchParams.get("after") ?? this.revision;
    const latest = this.#events.length;
    const cursor = Number(cursorText);
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    // Send headers now: without a first byte, Node holds them and the client never sees the stream open.
    response.flushHeaders();
    if (!Number.isInteger(cursor) || cursor > latest || latest - cursor > this.#retention) {
      response.end(`event: reset\ndata: ${JSON.stringify({ revision: String(latest) })}\n\n`);
      return;
    }
    for (const event of this.#events.slice(cursor)) response.write(this.#frame(event));
    this.#clients.add(response);
    request.on("close", () => this.#clients.delete(response));
  }
}
