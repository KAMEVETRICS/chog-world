import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../../src/api/server.js";
import { PgCult } from "../../src/db/pgCult.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName } from "../../src/fixture/chogs.js";
import type { SseOptions } from "../../src/api/events.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const T0 = Date.UTC(2026, 9, 20);
const key = (name: string) => chogByName(name).agentKey;
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function setup(sse: Partial<SseOptions> = {}) {
  const { pool } = await freshSchema();
  const clock = { ms: T0 };
  const reader = new FixtureChainReader(FIXTURE_CHOGS);
  const feed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), () => clock.ms);
  const cult = new PgCult({ pool, reader, feed, now: () => clock.ms });
  await cult.initialize("demo");
  await cult.registerChogs(FIXTURE_CHOGS);
  const app = await buildServer({ pool, sse: { pollMs: 20, heartbeatMs: 60_000, ...sse } });
  apps.push(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const step = async () => {
    clock.ms = (await cult.runtime()).nextBoundaryAtMs;
    expect((await cult.step()).kind).toBe("advanced");
  };
  return { pool, cult, app, address, step, clock, feed };
}

interface Frame { id?: string; event?: string; data?: string; comment?: string }

/** Reads SSE frames until `done` says stop (or the stream ends), then aborts the request. */
async function readFrames(url: string, done: (frames: Frame[]) => boolean, headers: Record<string, string> = {}, timeoutMs = 5000): Promise<Frame[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const frames: Frame[] = [];
  try {
    const response = await fetch(url, { headers, signal: abort.signal });
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (!done(frames)) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const frame: Frame = {};
        for (const line of block.split("\n")) {
          if (line.startsWith(":")) frame.comment = line.slice(1).trim();
          else if (line.startsWith("id: ")) frame.id = line.slice(4);
          else if (line.startsWith("event: ")) frame.event = line.slice(7);
          else if (line.startsWith("data: ")) frame.data = line.slice(6);
        }
        frames.push(frame);
      }
    }
    return frames;
  } catch (error) {
    if ((error as Error).name === "AbortError" && done(frames)) return frames;
    throw error;
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

const ids = (frames: Frame[]) => frames.filter((frame) => frame.id).map((frame) => Number(frame.id));

describeDb("public API", () => {
  it("reports health and a consistent snapshot, places and factions", async () => {
    const s = await setup();
    await s.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "crown" });
    await s.cult.setMembership(FIXTURE_HOLDERS.dave, key("Ember"), { faction: "chaos" });
    for (let index = 0; index < 8; index++) await s.step();
    const health = await s.app.inject({ url: "/api/health" });
    expect(health.json()).toEqual({ status: "ok", revision: (await s.cult.runtime()).revision });
    const snapshot = (await s.app.inject({ url: "/api/cult/snapshot" })).json();
    expect(snapshot).toMatchObject({ cycle: 2, phase: "propose", revision: (await s.cult.runtime()).revision });
    expect(snapshot.recentEvents.at(-1).revision).toBe(snapshot.revision);
    expect(snapshot.members).toHaveLength(FIXTURE_CHOGS.length);
    expect(JSON.stringify(snapshot)).not.toContain(FIXTURE_HOLDERS.alice);
    const places = (await s.app.inject({ url: "/api/cult/places" })).json();
    expect(places.places.map((place: { place: string }) => place.place)).toEqual(["plaza", "tavern", "workshop"]);
    expect(places.places.filter((place: { ruler: string | null }) => place.ruler).every((place: { decree: unknown }) => place.decree)).toBe(true);
    const factions = (await s.app.inject({ url: "/api/cult/factions" })).json();
    expect(factions.factions.map((faction: { id: string; members: number }) => [faction.id, faction.members])).toEqual([["crown", 1], ["chaos", 1]]);
  });

  it("returns one Chog with its effective votes, and errors in the standard envelope", async () => {
    const s = await setup();
    await s.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "crown" });
    for (let index = 0; index < 6; index++) await s.step();
    expect(await s.cult.override(FIXTURE_HOLDERS.alice, key("Regent"), "plaza", "hour-of-silence")).toMatchObject({ ok: true });
    const agent = (await s.app.inject({ url: `/api/cult/agents/${key("Regent")}` })).json();
    expect(agent.member).toMatchObject({ name: "Regent", faction: "crown", control: "verified" });
    expect(agent.member.currentVotes[0]).toEqual({ place: "plaza", decreeId: "hour-of-silence", source: "holder" });
    expect(agent.member.currentVotes.map((vote: { source: string }) => vote.source)).toEqual(["holder", "agent", "agent"]);
    const bad = await s.app.inject({ url: "/api/cult/agents/not-a-key" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "INVALID_INPUT", requestId: expect.any(String) } });
    const missing = await s.app.inject({ url: `/api/cult/agents/${key("Regent").replace(/:101$/, ":999")}` });
    expect(missing.statusCode).toBe(404);
    // The longest valid key (two 78-digit uint256 values) must reach the handler, not the router's length limit.
    const max = (2n ** 256n - 1n).toString();
    const longest = `31337:${"0x" + "a".repeat(40)}:${"0x" + "b".repeat(40)}:${"0x" + "c".repeat(40)}:${max}:${max}`;
    expect((await s.app.inject({ url: `/api/cult/agents/${longest}` })).json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    expect((await s.app.inject({ url: "/api/nope" })).json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describeDb("event stream", () => {
  it("replays from a cursor, then streams new events live without gaps or repeats", async () => {
    const s = await setup();
    await s.step();
    await s.step();
    const before = Number((await s.cult.runtime()).revision);
    const live = readFrames(`${s.address}/api/cult/events?after=0`, (frames) => ids(frames).length >= before + 4);
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (let index = 0; index < 3; index++) await s.step();
    const frames = await live;
    const seen = ids(frames);
    expect(seen.slice(0, before + 4)).toEqual(Array.from({ length: before + 4 }, (_, index) => index + 1));
    expect(frames[0]).toEqual({ comment: undefined });
    expect(JSON.parse(frames.find((frame) => frame.id === "1")!.data!)).toMatchObject({ revision: "1" });
  });

  it("resumes from Last-Event-ID, which takes precedence over ?after", async () => {
    const s = await setup();
    for (let index = 0; index < 3; index++) await s.step();
    const latest = Number((await s.cult.runtime()).revision);
    const frames = await readFrames(`${s.address}/api/cult/events?after=0`, (got) => ids(got).length >= 2, { "last-event-id": String(latest - 2) });
    expect(ids(frames)).toEqual([latest - 1, latest]);
  });

  it("starts at the current revision without a cursor, and rejects malformed cursors", async () => {
    const s = await setup();
    await s.step();
    const latest = Number((await s.cult.runtime()).revision);
    const pending = readFrames(`${s.address}/api/cult/events`, (got) => ids(got).length >= 1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await s.step();
    expect(ids(await pending)[0]).toBe(latest + 1);
    expect((await fetch(`${s.address}/api/cult/events?after=-1`)).status).toBe(400);
  });

  it("tells a client with a too-old or future cursor to reload the snapshot", async () => {
    const s = await setup({ retention: 2 });
    for (let index = 0; index < 3; index++) await s.step();
    const latest = (await s.cult.runtime()).revision;
    for (const cursor of ["0", String(Number(latest) + 5)]) {
      const frames = await readFrames(`${s.address}/api/cult/events?after=${cursor}`, (got) => got.some((frame) => frame.event === "reset"));
      expect(frames).toEqual([{ event: "reset", data: JSON.stringify({ revision: latest }) }]);
    }
  });

  it("sends heartbeats while idle", async () => {
    const s = await setup({ heartbeatMs: 50 });
    const frames = await readFrames(`${s.address}/api/cult/events`, (got) => got.some((frame) => frame.comment === "ping"));
    expect(frames.some((frame) => frame.comment === "ping")).toBe(true);
  });
});
