import { describe, expect, it } from "vitest";
import { makeAgentKey, type ChainReader } from "../../src/shared/identity.js";
import { PgCult } from "../../src/db/pgCult.js";
import { PgCity } from "../../src/citysim/pgCity.js";
import { PgCityFeed } from "../../src/citysim/cityFeed.js";
import { readCitySnapshot } from "../../src/citysim/readModel.js";
import { CITY_PLOTS, TICK_MS, step, type PublicChange } from "../../src/citysim/world.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName, type FixtureChog } from "../../src/fixture/chogs.js";
import { PHASES, TIMING } from "../../src/rules.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const T0 = Date.UTC(2026, 9, 20, 12);
const key = (name: string) => chogByName(name).agentKey;
const { alice, bob, hank } = FIXTURE_HOLDERS;

function extraChogs(count: number): FixtureChog[] {
  return Array.from({ length: count }, (_, index) => {
    const identity = { ...FIXTURE_CHOGS[0]!.identity, tokenId: String(200 + index), agentId: String(300 + index) };
    return { name: `Extra ${index + 1}`, identity, agentKey: makeAgentKey(identity), traits: {}, owner: hank };
  });
}

interface SetupOptions {
  /** Admit `chogs` as the server roster (default true). */
  readonly admit?: boolean;
  /** Cult reads City's real ticks instead of a fake feed. */
  readonly feed?: "city";
  readonly reader?: (fixture: FixtureChainReader) => ChainReader;
}

async function setup(chogs: readonly FixtureChog[] = FIXTURE_CHOGS, options: SetupOptions = {}) {
  const { pool } = await freshSchema();
  const clock = { ms: T0 };
  const fixture = new FixtureChainReader(chogs);
  const reader = options.reader?.(fixture) ?? fixture;
  const feed = options.feed === "city" ? new PgCityFeed(pool) : new FakeCityFeed(chogs.map((chog) => chog.agentKey), () => clock.ms);
  const cult = new PgCult({ pool, reader, feed, now: () => clock.ms });
  await cult.initialize("demo");
  await cult.registerChogs(chogs);
  const city = new PgCity({ pool, reader, now: () => clock.ms });
  await city.initialize();
  const admission = options.admit === false ? null : await city.admitRoster(chogs);
  const tick = async (count = 1) => {
    for (let index = 0; index < count; index++) {
      clock.ms = (await city.runtime()).nextDueAtMs;
      expect(await city.step()).toMatchObject({ kind: "advanced", ran: 1, skipped: 0 });
    }
  };
  const agent = async (name: string) => (await city.agent(key(name)))!;
  const events = async () => (await readCitySnapshot(pool)).recentEvents;
  return { pool, clock, reader: fixture, cult, city, admission, tick, agent, events };
}

async function withSession(pool: Awaited<ReturnType<typeof setup>>["pool"], id: string, address: string) {
  await pool.query("INSERT INTO sessions (id, token_hash, csrf_hash, address, chain_id, created_at, expires_at) VALUES ($1, 'x', 'y', $2, 31337, now(), now() + interval '1 hour')", [id, address]);
}

describeDb("City admission", () => {
  it("gives each roster Chog one plot in plot order with the grant, once per NFT", async () => {
    const s = await setup();
    expect(s.admission).toEqual({ admitted: FIXTURE_CHOGS.map((chog) => chog.agentKey).sort(), full: [], skipped: [] });
    const { world } = await readCitySnapshot(s.pool);
    expect(world.agents.map((agent) => agent.plotId)).toEqual(CITY_PLOTS.slice(0, 8).map((plot) => plot.id));
    for (const agent of world.agents) {
      expect(agent).toMatchObject({
        policy: { version: "1", active: true, focus: "builder", homeStyle: "cottage" }, homeLevel: 0, construction: null, controlAvailability: "verified",
        inventory: { wood: { total: 4, reserved: 0 }, stone: { total: 2, reserved: 0 }, food: { total: 4, reserved: 0 } },
      });
    }
    expect(await s.city.admitRoster(FIXTURE_CHOGS)).toEqual({ admitted: [], full: [], skipped: [] });
    // The same token arriving as another agent gets no second plot or grant.
    const regent = chogByName("Regent");
    expect(await s.city.admitRoster([{ name: "Regent again", identity: { ...regent.identity, agentId: "999" } }])).toEqual({ admitted: [], full: [], skipped: [] });
    expect((await s.pool.query("SELECT count(*)::int AS n FROM city_ledger WHERE reason = 'admission'")).rows[0].n).toBe(FIXTURE_CHOGS.length * 3);
    expect((await s.events()).filter((event) => event.type === "resident_admitted")).toHaveLength(8);
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("reports Chogs beyond the 12 plots as full and skips burned ones", async () => {
    const extras = extraChogs(6);
    const s = await setup([...FIXTURE_CHOGS, ...extras], { admit: false });
    s.reader.burn(chogByName("Pilot").identity);
    const admission = await s.city.admitRoster([...FIXTURE_CHOGS, ...extras.slice(0, 5)]);
    expect(admission.skipped).toEqual([key("Pilot")]);
    expect(admission.admitted).toHaveLength(12);
    expect(admission.full).toHaveLength(0);
    expect(await s.city.admitRoster(extras.slice(5))).toEqual({ admitted: [], full: [extras[5]!.agentKey], skipped: [] });
  });

  it("refuses a roster admission while ownership is unreadable", async () => {
    const s = await setup(FIXTURE_CHOGS, { admit: false });
    s.reader.setUnavailable(chogByName("Regent").identity, true);
    await expect(s.city.admitRoster(FIXTURE_CHOGS)).rejects.toThrow("Cannot admit Regent: ownership is unavailable.");
    expect((await readCitySnapshot(s.pool)).world.agents).toEqual([]);
  });

  it("lets only the current holder bring an awakened Chog in, once", async () => {
    const asleep = { ...chogByName("Pilot").identity, tokenId: "77", agentId: "177" };
    const s = await setup(FIXTURE_CHOGS, {
      admit: false,
      reader: (fixture) => ({
        resolveAgent: async (identity) => identity.tokenId === "77"
          ? { kind: "not_awakened", ownershipEpoch: "1", blockNumber: "1", blockHash: `0x${"0".repeat(64)}`, observedAtMs: 1, projectionGeneration: "1" }
          : fixture.resolveAgent(identity),
      }),
    });
    const regent = { name: "Regent", identity: chogByName("Regent").identity };
    expect(await s.city.admitByHolder(bob, regent)).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    s.reader.setUnavailable(regent.identity, true);
    expect(await s.city.admitByHolder(alice, regent)).toMatchObject({ ok: false, code: "OWNERSHIP_UNAVAILABLE" });
    s.reader.setUnavailable(regent.identity, false);
    expect(await s.city.admitByHolder(hank, { name: "Sleepy", identity: asleep })).toMatchObject({ ok: false, code: "NOT_AWAKENED" });
    const admitted = await s.city.admitByHolder(alice.toUpperCase().replace("0X", "0x"), regent);
    expect(admitted).toMatchObject({ ok: true, value: { key: key("Regent"), plotId: CITY_PLOTS[0]!.id, control: { controller: alice, epoch: "1" } } });
    expect(await s.city.admitByHolder(alice, regent)).toEqual(admitted);
    expect(await s.city.admitByHolder(alice, { ...regent, identity: { ...regent.identity, agentId: "999" } })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await s.pool.query("SELECT count(*)::int AS n FROM city_ledger")).rows[0].n).toBe(3);
  });

  it("says City is full when every plot is taken", async () => {
    const extras = extraChogs(13);
    const s = await setup(extras, { admit: false });
    expect((await s.city.admitRoster(extras.slice(0, 12))).admitted).toHaveLength(12);
    expect(await s.city.admitByHolder(hank, extras[12]!)).toMatchObject({ ok: false, code: "CITY_FULL" });
  });
});

describeDb("City scheduler", () => {
  it("waits for the tick, then matches City's pure simulation tick for tick with a balanced ledger", async () => {
    const s = await setup();
    expect(await s.city.step()).toEqual({ kind: "not_due", nextDueAtMs: T0 + TICK_MS });
    let expected = (await readCitySnapshot(s.pool)).world;
    for (let index = 0; index < 12; index++) expected = step({ world: expected }).world;
    await s.tick(12);
    const { world } = await readCitySnapshot(s.pool);
    expect(world.tick).toBe("12");
    expect(world.agents).toEqual(expected.agents);
    expect(world.agents.some((agent) => agent.homeLevel === 1)).toBe(true);
    expect(await s.city.reconcile()).toEqual([]);
    const ticks = (await s.pool.query("SELECT tick FROM city_ticks ORDER BY tick")).rows.map((row) => Number(row.tick));
    expect(ticks).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    const last = (await s.events()).filter((event) => event.type === "city_tick").at(-1)!;
    expect(last.data).toMatchObject({ tick: "12", changes: expect.any(Array), activities: expect.any(Array) });
  });

  it("runs at most three ticks after downtime and publishes the gap", async () => {
    const s = await setup();
    s.clock.ms = T0 + TICK_MS * 11;
    expect(await s.city.step()).toEqual({ kind: "advanced", tick: "3", ran: 3, skipped: 8 });
    expect(await s.city.runtime()).toMatchObject({ tick: "3", nextDueAtMs: s.clock.ms + TICK_MS });
    const gap = (await s.events()).find((event) => event.type === "simulation_gap");
    expect(gap?.data).toEqual({ tick: "0", changes: [], skippedTicks: 8 });
  });

  it("lets only one of several racing schedulers apply a tick", async () => {
    const s = await setup();
    s.clock.ms = T0 + TICK_MS;
    const racers = [s.city, new PgCity({ pool: s.pool, reader: s.reader, now: () => s.clock.ms }), new PgCity({ pool: s.pool, reader: s.reader, now: () => s.clock.ms })];
    const outcomes = await Promise.all(racers.map((racer) => racer.step()));
    expect(outcomes.filter((outcome) => outcome.kind === "advanced")).toHaveLength(1);
    expect((await s.pool.query("SELECT count(*)::int AS n FROM city_ticks")).rows[0].n).toBe(1);
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("pauses a sold Chog and keeps its plot, home and resources; selling it back never revives the old settings", async () => {
    const s = await setup();
    await s.tick(3);
    const building = await s.agent("Regent");
    expect(building.construction).not.toBeNull();
    s.reader.transfer(chogByName("Regent").identity, hank);
    await s.tick();
    const sold = await s.agent("Regent");
    expect(sold).toMatchObject({
      control: { kind: "controlled", controller: hank, epoch: "2" }, construction: null, plotId: building.plotId, homeLevel: building.homeLevel,
      policy: { active: false, focus: "builder", homeStyle: "cottage", version: "2" },
    });
    for (const resource of ["wood", "stone", "food"] as const) expect(sold.inventory[resource]).toEqual({ total: building.inventory[resource].total, reserved: 0 });
    const changes = (await s.events()).filter((event) => event.type === "control_changed").flatMap((event) => event.data.changes as PublicChange[]);
    expect(changes).toContainEqual({ type: "build_cancelled", agentKey: key("Regent"), actionId: building.construction!.actionId, cause: "control" });
    expect(await s.city.reconcile()).toEqual([]);
    await s.tick(3);
    expect(await s.agent("Regent")).toMatchObject({ location: sold.location, inventory: sold.inventory });

    s.reader.transfer(chogByName("Regent").identity, alice);
    await s.tick();
    expect(await s.agent("Regent")).toMatchObject({ control: { controller: alice, epoch: "3" }, policy: { active: false, version: "3" } });
    const restart = { active: true, focus: "builder", homeStyle: "cottage" } as const;
    expect(await s.city.setPolicy(alice, key("Regent"), restart, { expectedVersion: "1", expectedEpoch: "1" })).toMatchObject({ ok: false, code: "CONTROL_CHANGED" });
    expect(await s.city.setPolicy(alice, key("Regent"), restart, { expectedVersion: "3", expectedEpoch: "3" })).toMatchObject({ ok: true, value: { policy: { active: true, version: "4" } } });
  });

  it("freezes a Chog while its ownership can't be read, keeping its build, and resumes after", async () => {
    const s = await setup();
    await s.tick(3);
    const building = await s.agent("Regent");
    expect(building.construction).toMatchObject({ remainingTicks: 2 });
    s.reader.setUnavailable(chogByName("Regent").identity, true);
    await s.tick(2);
    const frozen = await s.agent("Regent");
    expect(frozen).toMatchObject({ controlAvailability: "unavailable", construction: building.construction, inventory: building.inventory, policy: building.policy, control: building.control });
    s.reader.setUnavailable(chogByName("Regent").identity, false);
    await s.tick();
    expect(await s.agent("Regent")).toMatchObject({ controlAvailability: "verified", construction: { remainingTicks: 1 } });
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("turns a burned Chog into ruins that keep their home", async () => {
    const s = await setup();
    await s.tick(5);
    const before = await s.agent("Regent");
    s.reader.burn(chogByName("Regent").identity);
    await s.tick();
    expect(await s.agent("Regent")).toMatchObject({ control: { kind: "burned", controller: null }, policy: { active: false }, construction: null, homeLevel: before.homeLevel, plotId: before.plotId });
    expect(await s.city.reconcile()).toEqual([]);
  });
});

describeDb("City holder settings", () => {
  const idem = (key: string, requestHash = "h1") => ({ sessionId: "a".repeat(32), key, requestHash });

  it("accept only the current holder with the current epoch and version, and cancel construction on a real change", async () => {
    const s = await setup();
    await withSession(s.pool, "a".repeat(32), alice);
    await s.tick(3);
    const regent = key("Regent");
    const social = { active: true, focus: "social", homeStyle: "treehouse" } as const;
    expect(await s.city.setPolicy(alice, key("Regent").replace(/:101$/, ":999"), social, { expectedVersion: "1", expectedEpoch: "1" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await s.city.setPolicy(bob, regent, social, { expectedVersion: "1", expectedEpoch: "1" })).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    expect(await s.city.setPolicy(alice, regent, social, { expectedVersion: "0", expectedEpoch: "1" })).toMatchObject({ ok: false, code: "POLICY_CHANGED" });
    expect(await s.city.setPolicy(alice, regent, social, { expectedVersion: "1", expectedEpoch: "9" })).toMatchObject({ ok: false, code: "CONTROL_CHANGED" });
    const same = await s.city.setPolicy(alice, regent, { active: true, focus: "builder", homeStyle: "cottage" }, { expectedVersion: "1", expectedEpoch: "1" });
    expect(same).toMatchObject({ ok: true, value: { policy: { version: "1" }, construction: { remainingTicks: 2 } } });
    const changed = await s.city.setPolicy(alice, regent, social, { expectedVersion: "1", expectedEpoch: "1", idempotency: idem("key-00001") });
    expect(changed).toMatchObject({ ok: true, value: { policy: { ...social, version: "2" }, construction: null, inventory: { wood: { reserved: 0 }, stone: { reserved: 0 }, food: { reserved: 0 } } } });
    expect(await s.city.setPolicy(alice, regent, social, { expectedVersion: "1", expectedEpoch: "1", idempotency: idem("key-00001") })).toEqual(changed);
    expect(await s.city.setPolicy(alice, regent, social, { expectedVersion: "2", expectedEpoch: "1", idempotency: idem("key-00001", "h2") })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" });
    const events = (await s.events()).filter((event) => event.type === "policy_changed");
    expect(events).toHaveLength(1);
    expect(events[0]!.data.changes.map((change) => change.type)).toEqual(["build_cancelled", "policy_changed"]);
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("do not store an ownership outage as the final answer for a key", async () => {
    const s = await setup();
    await withSession(s.pool, "a".repeat(32), alice);
    const regent = key("Regent");
    const request = { active: false, focus: "builder", homeStyle: "cottage" } as const;
    s.reader.setUnavailable(chogByName("Regent").identity, true);
    expect(await s.city.setPolicy(alice, regent, request, { expectedVersion: "1", expectedEpoch: "1", idempotency: idem("key-00002") })).toMatchObject({ ok: false, code: "OWNERSHIP_UNAVAILABLE" });
    s.reader.setUnavailable(chogByName("Regent").identity, false);
    expect(await s.city.setPolicy(alice, regent, request, { expectedVersion: "1", expectedEpoch: "1", idempotency: idem("key-00002") })).toMatchObject({ ok: true, value: { policy: { active: false } } });
  });
});

describeDb("City → Cult", () => {
  it("social Chogs in a faction earn Cult presence from real City ticks", async () => {
    const s = await setup(FIXTURE_CHOGS, { feed: "city" });
    await withSession(s.pool, "b".repeat(32), alice);
    expect(await s.cult.setMembership(alice, key("Regent"), { faction: "crown" })).toMatchObject({ ok: true });
    expect(await s.city.setPolicy(alice, key("Regent"), { active: true, focus: "social", homeStyle: "cottage" }, { expectedVersion: "1", expectedEpoch: "1" })).toMatchObject({ ok: true });
    const phaseMs = TIMING.demo.phaseMs;
    const cycleMs = PHASES.reduce((sum, phase) => sum + phaseMs[phase], 0);
    // Run City ticks and Cult phases on one clock through cycle 1's resolve.
    const resolveAt = T0 + cycleMs + phaseMs.propose + phaseMs.debate + phaseMs.vote;
    while (s.clock.ms < resolveAt) {
      const cityDue = (await s.city.runtime()).nextDueAtMs;
      const cultDue = (await s.cult.runtime()).nextBoundaryAtMs;
      s.clock.ms = Math.min(cityDue, cultDue, resolveAt);
      if (s.clock.ms >= cityDue) await s.city.step();
      if (s.clock.ms >= cultDue) await s.cult.step();
    }
    const result = await s.cult.result(1);
    expect(result).toBeDefined();
    const crownPresence = Object.values(result!.places).reduce((sum, place) => sum + place.influence.crown.presence, 0);
    expect(crownPresence).toBeGreaterThan(0);
    expect(crownPresence).toBeLessThanOrEqual(5 * 3);
    const types = (await s.cult.events()).map((event) => event.type);
    expect(types).not.toContain("city_gap");
    // About 70 City ticks and a full Cult cycle of simulated time: slower than the 20 s default under parallel load.
  }, 60_000);
});
