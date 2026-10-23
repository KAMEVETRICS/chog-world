import type { FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { toEventDto, type EventDto } from "./readModel.js";

/** Anything streamed: Cult's EventDto or City's CityEvent. Revisions are commit-ordered per stream. */
export interface StreamEvent {
  readonly revision: string;
  readonly type: string;
}

/** Where a stream's events and latest revision come from. */
export interface EventSource<T extends StreamEvent> {
  latest(pool: pg.Pool): Promise<bigint>;
  after(pool: pg.Pool, revision: bigint, limit: number): Promise<T[]>;
}

export const CULT_EVENTS: EventSource<EventDto> = {
  async latest(pool) {
    const { rows } = await pool.query<{ revision: string }>("SELECT revision FROM cult_runtime WHERE id = 1");
    return BigInt(rows[0]?.revision ?? 0);
  },
  async after(pool, revision, limit) {
    const { rows } = await pool.query("SELECT revision, cycle, type, payload, created_at FROM cult_events WHERE revision > $1 ORDER BY revision LIMIT $2", [revision.toString(), limit]);
    return rows.map(toEventDto);
  },
};

export interface SseOptions {
  /** How often the shared poller reads newly committed events. */
  readonly pollMs: number;
  readonly heartbeatMs: number;
  /** Replay window: a cursor further behind than this gets `reset` instead of a replay. */
  readonly retention: number;
  /** Events written while the client is not draining before it is disconnected. */
  readonly maxBuffer: number;
}

export const DEFAULT_SSE: SseOptions = { pollMs: 500, heartbeatMs: 15_000, retention: 10_000, maxBuffer: 100 };

export interface EventSink<T extends StreamEvent = EventDto> {
  deliver(event: T): void;
}

/**
 * One poller per process. Revisions are allocated under the cult_runtime row lock and committed in that
 * order, so reading `revision > last` never skips an event.
 */
export class EventHub<T extends StreamEvent = EventDto> {
  readonly #pool: pg.Pool;
  readonly #pollMs: number;
  readonly #source: EventSource<T>;
  readonly #sinks = new Set<EventSink<T>>();
  #last = 0n;
  #timer: NodeJS.Timeout | undefined;
  #polling = false;
  readonly #onError: (error: unknown) => void;

  constructor(pool: pg.Pool, pollMs: number, onError: (error: unknown) => void, source: EventSource<T> = CULT_EVENTS as unknown as EventSource<T>) {
    this.#pool = pool;
    this.#pollMs = pollMs;
    this.#onError = onError;
    this.#source = source;
  }

  async start(): Promise<void> {
    this.#last = await this.#source.latest(this.#pool);
    this.#timer = setInterval(() => { void this.poll(); }, this.#pollMs);
  }

  stop(): void {
    clearInterval(this.#timer);
    this.#sinks.clear();
  }

  subscribe(sink: EventSink<T>): () => void {
    this.#sinks.add(sink);
    return () => this.#sinks.delete(sink);
  }

  async poll(): Promise<void> {
    if (this.#polling) return;
    this.#polling = true;
    try {
      for (const event of await this.#source.after(this.#pool, this.#last, 1000)) {
        this.#last = BigInt(event.revision);
        for (const sink of this.#sinks) sink.deliver(event);
      }
    } catch (error) {
      // Reported, then retried on the next interval; connected clients keep their cursor.
      this.#onError(error);
    } finally {
      this.#polling = false;
    }
  }
}

/** The parts of a Node response stream the client uses. */
export interface SseStream {
  write(chunk: string): boolean;
  end(): void;
  destroy(): void;
  once(event: "drain", listener: () => void): unknown;
}

export function formatEvent(event: StreamEvent): string {
  return `id: ${event.revision}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * One SSE connection. While replaying it buffers live events, then sends them in revision order,
 * skipping anything already sent. A client that stops draining for `maxBuffer` events is dropped.
 */
export class SseClient<T extends StreamEvent = EventDto> implements EventSink<T> {
  readonly #stream: SseStream;
  readonly #maxBuffer: number;
  #lastSent: bigint;
  #replaying = true;
  #pending: T[] = [];
  #undrained = 0;
  #closed = false;

  constructor(stream: SseStream, cursor: bigint, maxBuffer: number) {
    this.#stream = stream;
    this.#lastSent = cursor;
    this.#maxBuffer = maxBuffer;
  }

  get closed(): boolean { return this.#closed; }
  get lastSent(): bigint { return this.#lastSent; }

  #send(event: T): void {
    if (this.#closed || BigInt(event.revision) <= this.#lastSent) return;
    this.#lastSent = BigInt(event.revision);
    if (this.#stream.write(formatEvent(event))) return;
    this.#undrained += 1;
    if (this.#undrained === 1) this.#stream.once("drain", () => { this.#undrained = 0; });
    if (this.#undrained > this.#maxBuffer) this.close(true);
  }

  deliver(event: T): void {
    if (this.#replaying) this.#pending.push(event);
    else this.#send(event);
  }

  replay(events: readonly T[]): void {
    for (const event of events) this.#send(event);
  }

  finishReplay(): void {
    this.#replaying = false;
    const pending = this.#pending.sort((a, b) => (BigInt(a.revision) < BigInt(b.revision) ? -1 : 1));
    this.#pending = [];
    for (const event of pending) this.#send(event);
  }

  heartbeat(): void {
    if (!this.#closed) this.#stream.write(": ping\n\n");
  }

  close(slow = false): void {
    if (this.#closed) return;
    this.#closed = true;
    if (slow) this.#stream.destroy();
    else this.#stream.end();
  }
}

const REVISION = /^(0|[1-9][0-9]{0,18})$/;

export interface StreamOptions<T extends StreamEvent> {
  readonly pool: pg.Pool;
  readonly hub: EventHub<T>;
  readonly source: EventSource<T>;
  readonly sse: SseOptions;
  readonly clients: Set<{ close(): void }>;
  readonly invalidCursor: () => Error;
}

/**
 * Serves one SSE stream. Resume with Last-Event-ID (preferred) or ?after=<revision from a snapshot>;
 * without either the stream starts at the current revision. A cursor outside the replay window, or in
 * the future, gets `reset` and the client reloads its snapshot.
 */
export async function serveStream<T extends StreamEvent>(request: FastifyRequest<{ Querystring: { after?: string } }>, reply: FastifyReply, options: StreamOptions<T>): Promise<void> {
  const { pool, hub, source, sse, clients } = options;
  const header = request.headers["last-event-id"];
  const requested = typeof header === "string" && header !== "" ? header : request.query.after;
  if (requested !== undefined && !REVISION.test(requested)) throw options.invalidCursor();
  const latest = await source.latest(pool);
  const cursor = requested === undefined ? latest : BigInt(requested);

  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
  if (cursor > latest || latest - cursor > BigInt(sse.retention)) {
    raw.write(`event: reset\ndata: ${JSON.stringify({ revision: latest.toString() })}\n\n`);
    raw.end();
    return;
  }
  const client = new SseClient<T>(raw, cursor, sse.maxBuffer);
  const unsubscribe = hub.subscribe(client);
  clients.add(client);
  const heartbeat = setInterval(() => client.heartbeat(), sse.heartbeatMs);
  const cleanup = () => { clearInterval(heartbeat); unsubscribe(); clients.delete(client); client.close(); };
  request.raw.on("close", cleanup);
  try {
    raw.write("retry: 3000\n\n");
    client.replay(await source.after(pool, cursor, sse.retention));
    client.finishReplay();
  } catch (error) {
    request.log.error({ err: error }, "event replay failed");
    cleanup();
    raw.destroy();
  }
}
