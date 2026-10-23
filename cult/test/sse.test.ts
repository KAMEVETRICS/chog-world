import { describe, expect, it } from "vitest";
import { SseClient, formatEvent, type SseStream } from "../src/api/events.js";
import type { EventDto } from "../src/api/readModel.js";

const event = (revision: number): EventDto => ({ revision: String(revision), cycle: 0, type: "phase_changed", payload: { phase: "debate" }, createdAt: "2026-10-20T00:00:00.000Z" });

class FakeStream implements SseStream {
  writes: string[] = [];
  ended = false;
  destroyed = false;
  accepting = true;
  #drain: (() => void) | undefined;
  write(chunk: string) { this.writes.push(chunk); return this.accepting; }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; }
  once(_event: "drain", listener: () => void) { this.#drain = listener; }
  drain() { this.accepting = true; this.#drain?.(); }
  ids() { return this.writes.map((chunk) => /^id: (\d+)/.exec(chunk)?.[1]).filter(Boolean).map(Number); }
}

describe("SSE client", () => {
  it("formats one event per frame with its revision as the id", () => {
    expect(formatEvent(event(7))).toBe(`id: 7\nevent: phase_changed\ndata: ${JSON.stringify(event(7))}\n\n`);
  });

  it("buffers live events during replay, then sends everything once and in order", () => {
    const stream = new FakeStream();
    const client = new SseClient(stream, 3n, 100);
    client.deliver(event(6));
    client.deliver(event(5));
    client.replay([event(3), event(4), event(5)]);
    client.deliver(event(7));
    client.finishReplay();
    client.deliver(event(6));
    client.deliver(event(8));
    expect(stream.ids()).toEqual([4, 5, 6, 7, 8]);
    expect(client.lastSent).toBe(8n);
  });

  it("drops a client that stops draining for more than the buffer limit, and keeps one that drains", () => {
    const slow = new FakeStream();
    slow.accepting = false;
    const client = new SseClient(slow, 0n, 3);
    client.finishReplay();
    for (let revision = 1; revision <= 3; revision++) client.deliver(event(revision));
    expect(slow.destroyed).toBe(false);
    client.deliver(event(4));
    expect(slow.destroyed).toBe(true);
    expect(client.closed).toBe(true);
    client.deliver(event(5));
    expect(slow.ids()).toEqual([1, 2, 3, 4]);

    const recovering = new FakeStream();
    recovering.accepting = false;
    const ok = new SseClient(recovering, 0n, 3);
    ok.finishReplay();
    for (let revision = 1; revision <= 3; revision++) ok.deliver(event(revision));
    recovering.drain();
    recovering.accepting = false;
    for (let revision = 4; revision <= 6; revision++) ok.deliver(event(revision));
    expect(recovering.destroyed).toBe(false);
  });

  it("sends heartbeats as comments and stops writing after close", () => {
    const stream = new FakeStream();
    const client = new SseClient(stream, 0n, 10);
    client.heartbeat();
    client.close();
    client.heartbeat();
    expect(stream.writes).toEqual([": ping\n\n"]);
    expect(stream.ended).toBe(true);
  });
});
