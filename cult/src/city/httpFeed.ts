import { fromCityEvent } from "./contract.js";
import type { CityFeed, CityFeedRead, CityTickEvent } from "./feed.js";

export interface HttpCityFeedOptions {
  /** City API origin, for example "https://city.example". */
  readonly baseUrl: string;
  /** No event or heartbeat for this long counts as City being down. City heartbeats every 15 seconds. */
  readonly staleMs?: number;
  readonly maxBuffer?: number;
  readonly reconnectMs?: number;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
}

interface Gap { readonly before: bigint; readonly resumeFrom: bigint; readonly reason: string }

/**
 * Follows Chog City's public event stream and buffers its ticks for the Cult scheduler. One connection,
 * resumed with Last-Event-ID after drops. A City `reset`, or buffer pruning past an unread cursor, is a
 * gap: the next read reports it once, with the revision to resume from.
 */
export class HttpCityFeed implements CityFeed {
  readonly #baseUrl: string;
  readonly #staleMs: number;
  readonly #maxBuffer: number;
  readonly #reconnectMs: number;
  readonly #now: () => number;
  readonly #onError: (error: unknown) => void;
  #buffer: CityTickEvent[] = [];
  #last = 0n;
  #connected = false;
  #lastSeenMs = 0;
  #gaps: Gap[] = [];
  #abort: AbortController | undefined;
  #stopped = true;
  #loop: Promise<void> | undefined;

  constructor(options: HttpCityFeedOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#staleMs = options.staleMs ?? 45_000;
    this.#maxBuffer = options.maxBuffer ?? 20_000;
    this.#reconnectMs = options.reconnectMs ?? 2_000;
    this.#now = options.now ?? Date.now;
    this.#onError = options.onError ?? (() => {});
  }

  /** Starts following City after `fromRevision` (the Cult's stored City cursor). */
  start(fromRevision: string): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.#last = BigInt(fromRevision);
    this.#loop = this.#run();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#abort?.abort();
    await this.#loop;
  }

  get connected(): boolean { return this.#connected; }

  async #run(): Promise<void> {
    let delay = this.#reconnectMs;
    while (!this.#stopped) {
      try {
        await this.#follow();
        delay = this.#reconnectMs;
      } catch (error) {
        if (!this.#stopped) this.#onError(error);
      }
      this.#connected = false;
      if (this.#stopped) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }

  async #follow(): Promise<void> {
    this.#abort = new AbortController();
    const response = await fetch(`${this.#baseUrl}/api/city/events?after=${this.#last}`, {
      headers: { accept: "text/event-stream", "last-event-id": this.#last.toString() }, signal: this.#abort.signal,
    });
    if (!response.ok || !response.body) throw new Error(`City events returned HTTP ${response.status}.`);
    this.#connected = true;
    this.#lastSeenMs = this.#now();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        this.#lastSeenMs = this.#now();
        let type = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) type = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue; // a comment or heartbeat
        if (type === "reset") {
          const resumeFrom = BigInt(JSON.parse(data).revision);
          this.#gaps.push({ before: this.#last, resumeFrom, reason: "City's replay window was exceeded; some activity was not received" });
          this.#last = resumeFrom;
          return;
        }
        this.#accept(JSON.parse(data));
      }
    }
  }

  #accept(event: unknown): void {
    const revisionText = (event as { revision?: unknown } | null)?.revision;
    const revision = typeof revisionText === "string" && /^(0|[1-9][0-9]*)$/.test(revisionText) ? BigInt(revisionText) : null;
    if (revision !== null && revision <= this.#last) return; // already received before a reconnect
    let tick: CityTickEvent | null;
    try { tick = fromCityEvent(event); }
    catch (error) {
      // A malformed tick is reported and skipped; it must not stop the stream or be counted.
      this.#onError(error);
      if (revision !== null) this.#last = revision;
      return;
    }
    this.#last = revision!;
    if (!tick) return;
    this.#buffer.push(tick);
    if (this.#buffer.length > this.#maxBuffer) {
      const dropped = this.#buffer.splice(0, this.#buffer.length - this.#maxBuffer);
      const newest = BigInt(dropped.at(-1)!.revision);
      this.#gaps.push({ before: newest, resumeFrom: newest, reason: "Cult fell too far behind City; older activity was dropped" });
    }
  }

  async eventsSince(revision: string): Promise<CityFeedRead> {
    const cursor = BigInt(revision);
    // Report every gap after the cursor at once, resuming from the furthest point, so several losses
    // between two reads cost one cycle of presence rather than one each.
    const gap = this.#gaps.filter((entry) => entry.before >= cursor).reduce<Gap | undefined>((furthest, entry) => (!furthest || entry.resumeFrom > furthest.resumeFrom ? entry : furthest), undefined);
    if (gap) {
      this.#gaps = this.#gaps.filter((entry) => entry.resumeFrom > gap.resumeFrom);
      this.#buffer = this.#buffer.filter((event) => BigInt(event.revision) > gap.resumeFrom);
      return { available: false, reason: gap.reason, resumeFrom: gap.resumeFrom.toString() };
    }
    if (!this.#connected || this.#now() - this.#lastSeenMs > this.#staleMs) return { available: false, reason: "City feed unreachable" };
    // Everything up to the cursor has been counted; keep the buffer small.
    this.#buffer = this.#buffer.filter((event) => BigInt(event.revision) > cursor);
    return { available: true, events: [...this.#buffer] };
  }
}
