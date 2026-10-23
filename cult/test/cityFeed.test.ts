import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { fromCityEvent } from "../src/city/contract.js";
import { HttpCityFeed } from "../src/city/httpFeed.js";
import { FakeCityServer } from "../src/fixture/fakeCityServer.js";
import { agent } from "./fixtures.js";

const CONTRACT = new URL("../../docs/superpowers/specs/2026-10-19-cult-city-contract.md", import.meta.url);

/** Every ```json block in the contract that follows a line containing `label`. */
function contractExample(label: string): unknown {
  const text = fs.readFileSync(CONTRACT, "utf8");
  const match = new RegExp(`${label}[^\\n]*\\n+\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``).exec(text);
  if (!match) throw new Error(`No JSON example labelled ${label} in the contract.`);
  return JSON.parse(match[1]!);
}

const stops: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0).reverse()) await stop(); });

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const visit = (tokenId: number, placeId: "plaza" | "tavern" | "workshop" | "farm") => ({ agentKey: agent(tokenId), kind: "visit" as const, location: { kind: "place" as const, placeId } });

async function setup(options: { retention?: number; staleMs?: number; maxBuffer?: number } = {}) {
  const city = new FakeCityServer({ retention: options.retention ?? 10_000, heartbeatMs: 50 });
  await city.start();
  const errors: unknown[] = [];
  const feed = new HttpCityFeed({ baseUrl: city.url, reconnectMs: 20, staleMs: options.staleMs ?? 2000, maxBuffer: options.maxBuffer ?? 20_000, onError: (error) => errors.push(error) });
  stops.push(() => city.stop(), () => feed.stop());
  return { city, feed, errors };
}

describe("Cult ⇄ City contract", () => {
  it("accepts the contract's own city_tick example and converts it for Cult", () => {
    const tick = fromCityEvent(contractExample("Example `city_tick`"));
    expect(tick).toMatchObject({ revision: "4812", tick: "1530", committedAtMs: Date.parse("2026-10-20T18:04:10.000Z") });
    expect(tick!.activities.map((activity) => [activity.kind, activity.location])).toEqual([["visit", "plaza"], ["greet", "plaza"], ["gather", "forest"], ["build", "home"]]);
  });

  it("documents a place_control_changed example that matches Cult's payload type", () => {
    const example = contractExample("Example `place_control_changed`") as { type: string; payload: { place: string; control: { faction: string; decreeId: string; sinceCycle: number } } };
    expect(example.type).toBe("place_control_changed");
    expect(Object.keys(example.payload).sort()).toEqual(["control", "place"]);
    expect(Object.keys(example.payload.control).sort()).toEqual(["decreeId", "faction", "sinceCycle"]);
  });

  it("ignores other City events and rejects malformed ticks loudly", () => {
    expect(fromCityEvent({ revision: "5", type: "policy_changed", data: {}, createdAt: "2026-10-20T00:00:00Z" })).toBeNull();
    const good = { revision: "6", type: "city_tick", createdAt: "2026-10-20T00:00:00Z", data: { tick: "6", activities: [visit(1, "plaza")] } };
    expect(fromCityEvent(good)).not.toBeNull();
    for (const broken of [
      { ...good, revision: "06" },
      { ...good, createdAt: "yesterday" },
      { ...good, data: { tick: "6" } },
      { ...good, data: { tick: "6", activities: [{ ...visit(1, "plaza"), kind: "dance" }] } },
      { ...good, data: { tick: "6", activities: [{ ...visit(1, "plaza"), location: { kind: "place", placeId: "moon" } }] } },
      { ...good, data: { tick: "6", activities: [{ ...visit(1, "plaza"), agentKey: "1:2" }] } },
    ]) expect(() => fromCityEvent(broken)).toThrow();
  });
});

describe("live City feed", () => {
  it("buffers City ticks and returns only those after the Cult's cursor", async () => {
    const { city, feed } = await setup();
    city.publishTick([visit(1, "plaza")], 1000);
    city.publish("policy_changed", {}, 1500);
    city.publishTick([visit(2, "tavern")], 2000);
    feed.start("0");
    await until(async () => { const read = await feed.eventsSince("0"); return read.available && read.events.length === 2; });
    expect(await feed.eventsSince("1")).toMatchObject({ available: true, events: [{ revision: "3", committedAtMs: 2000 }] });
  });

  it("reports City as unreachable while down, then resumes without losing or repeating ticks", async () => {
    const { city, feed } = await setup();
    feed.start("0");
    city.publishTick([visit(1, "plaza")], 1000);
    await until(async () => (await feed.eventsSince("0")).available);
    await city.stop();
    await until(async () => !(await feed.eventsSince("0")).available);
    expect(await feed.eventsSince("0")).toEqual({ available: false, reason: "City feed unreachable" });
    // City keeps its history while down; the next connection resumes from the last revision received.
    city.publishTick([visit(2, "tavern")], 2000);
    await city.start();
    await until(async () => { const read = await feed.eventsSince("0"); return read.available && read.events.length === 2; });
    const read = await feed.eventsSince("0");
    expect(read.available && read.events.map((event) => event.revision)).toEqual(["1", "2"]);
  });

  it("treats a silent connection as down", async () => {
    let now = 0;
    const city = new FakeCityServer({ heartbeatMs: 60_000 });
    await city.start();
    const feed = new HttpCityFeed({ baseUrl: city.url, staleMs: 45_000, now: () => now });
    stops.push(() => city.stop(), () => feed.stop());
    feed.start("0");
    await until(() => feed.connected);
    expect((await feed.eventsSince("0")).available).toBe(true);
    now += 45_001;
    expect(await feed.eventsSince("0")).toEqual({ available: false, reason: "City feed unreachable" });
  });

  it("reports a replay-window reset once, with the revision to resume from", async () => {
    const { city, feed } = await setup({ retention: 2 });
    for (let index = 0; index < 5; index++) city.publishTick([visit(1, "plaza")], 1000 + index);
    feed.start("0");
    await until(async () => { const read = await feed.eventsSince("0"); return !read.available && read.resumeFrom !== undefined; });
    city.publishTick([visit(2, "farm")], 9000);
    await until(async () => (await feed.eventsSince("5")).available);
    const read = await feed.eventsSince("5");
    expect(read.available && read.events.map((event) => event.revision)).toEqual(["6"]);
  });

  it("skips and reports a malformed tick without stopping the stream", async () => {
    const { city, feed, errors } = await setup();
    feed.start("0");
    city.publish("city_tick", { tick: "1", activities: [{ agentKey: "bad", kind: "visit", location: { kind: "place", placeId: "plaza" } }] }, 1000);
    city.publishTick([visit(1, "plaza")], 2000);
    await until(async () => { const read = await feed.eventsSince("0"); return read.available && read.events.length === 1; });
    expect(errors.some((error) => /does not match the contract/.test(String(error)))).toBe(true);
  });

  it("reports a gap when the Cult falls further behind than the buffer holds", async () => {
    const { city, feed } = await setup({ maxBuffer: 2 });
    feed.start("0");
    await until(() => feed.connected);
    for (let index = 0; index < 4; index++) city.publishTick([visit(1, "plaza")], 1000 + index);
    let gap: Awaited<ReturnType<typeof feed.eventsSince>> | undefined;
    await until(async () => { gap = await feed.eventsSince("0"); return !gap.available && gap.resumeFrom !== undefined; });
    expect(gap).toMatchObject({ available: false, resumeFrom: "2" });
    const read = await feed.eventsSince("2");
    expect(read.available && read.events.map((event) => event.revision)).toEqual(["3", "4"]);
  });
});
