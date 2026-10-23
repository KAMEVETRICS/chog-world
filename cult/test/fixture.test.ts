import { describe, expect, it } from "vitest";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName } from "../src/fixture/chogs.js";
import { FixtureChainReader } from "../src/fixture/chainReader.js";
import { FakeCityFeed } from "../src/fixture/cityFeed.js";
import { presenceFromCity, type CityTickEvent } from "../src/city/feed.js";
import { MemoryCouncil } from "../src/council/memoryCouncil.js";
import { runDemo } from "../src/demo/runDemo.js";
import { debateLines } from "../src/engine/debate.js";
import { member } from "./fixtures.js";

const regent = chogByName("Regent");
const ember = chogByName("Ember");

function setup() {
  let clock = 1_000_000;
  const now = () => clock;
  const reader = new FixtureChainReader(FIXTURE_CHOGS);
  const feed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), now);
  const council = new MemoryCouncil({ reader, feed, chogs: FIXTURE_CHOGS, now });
  return { reader, feed, council, tick: (ms: number) => { clock += ms; } };
}

async function toPhase(council: MemoryCouncil, cycle: number, phase: string) {
  while (council.cycle !== cycle || council.phase !== phase) await council.advance();
}

describe("fixture Chogs and ownership", () => {
  it("uses valid, distinct fixture holders and identities", () => {
    for (const address of Object.values(FIXTURE_HOLDERS)) expect(address).toMatch(/^0x[0-9a-f]{40}$/);
    expect(new Set(FIXTURE_CHOGS.map((chog) => chog.agentKey)).size).toBe(FIXTURE_CHOGS.length);
  });

  it("advances the epoch on every transfer, including back to an earlier owner, and reports outages and burns", async () => {
    const reader = new FixtureChainReader(FIXTURE_CHOGS);
    expect(await reader.resolveAgent(regent.identity)).toMatchObject({ kind: "controlled", controller: FIXTURE_HOLDERS.alice, ownershipEpoch: "1" });
    reader.transfer(regent.identity, FIXTURE_HOLDERS.bob);
    reader.transfer(regent.identity, FIXTURE_HOLDERS.alice);
    expect(await reader.resolveAgent(regent.identity)).toMatchObject({ controller: FIXTURE_HOLDERS.alice, ownershipEpoch: "3" });
    reader.setUnavailable(regent.identity, true);
    expect(await reader.resolveAgent(regent.identity)).toEqual({ kind: "unavailable", reason: "rpc" });
    reader.setUnavailable(regent.identity, false);
    reader.burn(regent.identity);
    expect(await reader.resolveAgent(regent.identity)).toMatchObject({ kind: "burned", ownershipEpoch: "4" });
    expect(() => reader.transfer(regent.identity, FIXTURE_HOLDERS.bob)).toThrow(/burned/);
  });
});

describe("City feed", () => {
  it("is deterministic, ordered by revision, and unavailable while down", async () => {
    const make = () => { const feed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), () => 5_000); feed.runTicks(4); return feed; };
    const first = await make().eventsSince("0");
    expect(first).toEqual(await make().eventsSince("0"));
    if (!first.available) throw new Error("feed should be up");
    expect(first.events.map((event) => [event.revision, event.committedAtMs])).toEqual([["1", 5_000], ["2", 15_000], ["3", 25_000], ["4", 35_000]]);
    const feed = make();
    expect(await feed.eventsSince("2")).toMatchObject({ available: true, events: [{ revision: "3" }, { revision: "4" }] });
    feed.setDown(true);
    expect(await feed.eventsSince("0")).toMatchObject({ available: false });
  });

  it("turns only visits and greets at Cult places inside the cycle window into presence", () => {
    const a = regent.agentKey;
    const events: CityTickEvent[] = [
      { revision: "1", tick: "1", committedAtMs: 50, activities: [{ agentKey: a, kind: "visit", location: "plaza" }] },
      { revision: "2", tick: "2", committedAtMs: 100, activities: [
        { agentKey: a, kind: "visit", location: "plaza" }, { agentKey: a, kind: "greet", location: "tavern" },
        { agentKey: a, kind: "gather", location: "workshop" }, { agentKey: a, kind: "visit", location: "forest" },
      ] },
      { revision: "3", tick: "3", committedAtMs: 200, activities: [{ agentKey: a, kind: "greet", location: "workshop" }] },
    ];
    expect(presenceFromCity(events, 4, { fromMs: 100, toMs: 200 })).toEqual({
      records: [
        { cycle: 4, agentKey: a, place: "plaza", points: 1, cityRevision: "2" },
        { cycle: 4, agentKey: a, place: "tavern", points: 1, cityRevision: "2" },
      ],
      late: 1,
    });
  });
});

describe("scripted debate", () => {
  it("is labelled scripted, deterministic, and only comes from eligible persona members", () => {
    const members = [member(1, "crown"), member(2, "chaos"), member(3, "crown", { stance: "abstain" }), member(4, "chaos", { joinedCycle: 2 })];
    const lines = debateLines(members, 2, {});
    expect(lines.map((line) => line.agentKey)).toEqual([members[0]!.agentKey, members[1]!.agentKey]);
    expect(lines.every((line) => line.scripted && line.text.length > 0)).toBe(true);
    expect(debateLines(members, 2, {})).toEqual(lines);
  });
});

describe("in-memory council", () => {
  it("lets only the current holder act and reports ownership outages", async () => {
    const { council, reader } = setup();
    await council.start();
    expect(await council.setMembership(FIXTURE_HOLDERS.bob, regent.agentKey, { faction: "crown" })).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    expect(await council.setMembership(FIXTURE_HOLDERS.alice.toUpperCase().replace("0X", "0x"), regent.agentKey, { faction: "crown" })).toMatchObject({ ok: true });
    reader.setUnavailable(regent.identity, true);
    expect(await council.setMembership(FIXTURE_HOLDERS.alice, regent.agentKey, { stance: "abstain" })).toMatchObject({ ok: false, code: "OWNERSHIP_UNAVAILABLE" });
  });

  it("casts agent votes at Vote open, accepts overrides only during Vote, and resolves once", async () => {
    const { council, feed } = setup();
    await council.start();
    await council.setMembership(FIXTURE_HOLDERS.alice, regent.agentKey, { faction: "crown" });
    await council.setMembership(FIXTURE_HOLDERS.dave, ember.agentKey, { faction: "chaos" });
    await toPhase(council, 1, "debate");
    expect(await council.override(FIXTURE_HOLDERS.alice, regent.agentKey, "plaza", "golden-lanterns")).toMatchObject({ ok: false, code: "VOTING_CLOSED" });
    feed.runTicks(3);
    await council.advance();
    expect(council.currentVotes().filter((vote) => vote.source === "agent")).toHaveLength(6);
    expect(await council.override(FIXTURE_HOLDERS.alice, regent.agentKey, "plaza", "golden-lanterns")).toMatchObject({ ok: true });
    expect(await council.override(FIXTURE_HOLDERS.alice, regent.agentKey, "plaza", "hour-of-silence")).toMatchObject({ ok: true });
    expect(council.currentVotes().filter((vote) => vote.source === "holder")).toHaveLength(1);
    await council.advance();
    const result = council.result(1)!;
    expect(result.places.plaza.decreeVotes["hour-of-silence"]).toBe(1);
    const reputation = council.reputation;
    expect(await council.resolve()).toBe(result);
    expect(council.reputation).toBe(reputation);
  });

  it("resets a sold Chog, voids the seller's votes, and gives the buyer a fresh start", async () => {
    const { council, reader } = setup();
    await council.start();
    await council.setMembership(FIXTURE_HOLDERS.alice, regent.agentKey, { faction: "crown" });
    await toPhase(council, 1, "vote");
    reader.transfer(regent.identity, FIXTURE_HOLDERS.hank);
    expect(await council.override(FIXTURE_HOLDERS.alice, regent.agentKey, "plaza", "crown-parade")).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    expect(council.member(regent.agentKey)).toMatchObject({ faction: null, stance: "abstain", ownershipEpoch: "2", history: [{ faction: "crown", fromCycle: 0, toCycle: 1 }] });
    expect(await council.setMembership(FIXTURE_HOLDERS.hank, regent.agentKey, { faction: "chaos" })).toMatchObject({ ok: true, value: { faction: "chaos", joinedCycle: 1 } });
    await council.advance();
    const result = council.result(1)!;
    expect(result.countedVotes).toEqual([]);
    expect(result.rejectedVotes.every((entry) => entry.vote.agentKey === regent.agentKey)).toBe(true);
    expect(result.places.plaza.outcome).toBe("no_contest");
  });
});

describe("demo", () => {
  it("tells the whole scripted story and prints identical output every run", async () => {
    const first = await runDemo();
    const second = await runDemo();
    expect(second.lines).toEqual(first.lines);
    const text = first.lines.join("\n");
    for (const expected of [
      "SWITCH_COOLDOWN", "NOT_CONTROLLER", "counts from cycle 3", "Butler: control verified (ownership epoch 2)",
      "No City presence this cycle", "Glitch: control unavailable", "Ignored 12 City ticks from an earlier cycle",
      "bob switches Banker to chaos (cooldown over)", "Final standings:",
    ]) expect(text).toContain(expected);
    expect(text).not.toContain("✗ alice");
    expect(first.council.result(4)!.places.plaza.influence.chaos.presence).toBe(0);
  });
});
