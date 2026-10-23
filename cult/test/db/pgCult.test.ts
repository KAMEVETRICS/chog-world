import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { PgCult } from "../../src/db/pgCult.js";
import { MemoryCouncil } from "../../src/council/memoryCouncil.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName } from "../../src/fixture/chogs.js";
import { PHASES, TIMING, type Phase } from "../../src/rules.js";
import { DATABASE_URL, freshSchema, poolFor } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const T0 = Date.UTC(2026, 9, 20);
const phaseMs = (phase: Phase) => TIMING.demo.phaseMs[phase];
const key = (name: string) => chogByName(name).agentKey;
const MIGRATIONS = fs.readdirSync(new URL("../../migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort();

async function world(options: { schema?: { pool: import("pg").Pool } } = {}) {
  const { pool } = options.schema ?? (await freshSchema());
  const clock = { ms: T0 };
  const reader = new FixtureChainReader(FIXTURE_CHOGS);
  const feed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), () => clock.ms);
  const cult = new PgCult({ pool, reader, feed, now: () => clock.ms });
  await cult.initialize("demo");
  await cult.registerChogs(FIXTURE_CHOGS);
  return { pool, clock, reader, feed, cult };
}

/** Moves the clock to the current boundary and runs the one due transition. */
async function nextPhase(w: Awaited<ReturnType<typeof world>>) {
  w.clock.ms = (await w.cult.runtime()).nextBoundaryAtMs;
  const outcome = await w.cult.step();
  expect(outcome.kind).toBe("advanced");
  return outcome;
}

async function toPhase(w: Awaited<ReturnType<typeof world>>, cycle: number, phase: Phase) {
  for (let guard = 0; guard < 40; guard++) {
    const runtime = await w.cult.runtime();
    if (runtime.cycle === cycle && runtime.phase === phase) return;
    await nextPhase(w);
  }
  throw new Error("did not reach phase");
}

describeDb("migrations", () => {
  it("apply once, skip on rerun, and refuse an edited migration", async () => {
    const { pool } = await freshSchema({ migrated: false });
    expect(MIGRATIONS[0]).toBe("001_init.sql");
    expect(await migrate(pool)).toEqual({ applied: MIGRATIONS, skipped: [] });
    expect(await migrate(pool)).toEqual({ applied: [], skipped: MIGRATIONS });
    await pool.query("UPDATE cult_migrations SET checksum = 'edited' WHERE name = '001_init.sql'");
    await expect(migrate(pool)).rejects.toThrow(/changed after it was applied/);
  });

  it("are safe when two processes start at once", async () => {
    const { schema } = await freshSchema({ migrated: false });
    const reports = await Promise.all([migrate(poolFor(schema)), migrate(poolFor(schema))]);
    expect(reports.map((report) => report.applied.length).sort()).toEqual([0, MIGRATIONS.length]);
  });

  it("enforce the rules in the schema itself", async () => {
    const w = await world();
    await expect(w.pool.query("UPDATE cult_runtime SET phase = 'party'")).rejects.toThrow(/check constraint/);
    await expect(w.pool.query("UPDATE members SET faction = 'crown' WHERE agent_key = $1", [key("Regent")])).rejects.toThrow(/check constraint/);
    await expect(w.pool.query("INSERT INTO votes (cycle, agent_key, place, source, faction, decree_id, ownership_epoch) VALUES (0, $1, 'plaza', 'agent', 'crown', NULL, 1)", [key("Regent")])).rejects.toThrow(/check constraint/);
  });
});

describeDb("scheduler", () => {
  it("waits for the boundary, then runs one transition per step", async () => {
    const w = await world();
    expect(await w.cult.step()).toEqual({ kind: "not_due", nextBoundaryAtMs: T0 + phaseMs("propose") });
    expect(await nextPhase(w)).toEqual({ kind: "advanced", cycle: 0, phase: "debate" });
    expect(await w.cult.step()).toMatchObject({ kind: "not_due" });
  });

  it("produces exactly the in-memory council's results for the same story", async () => {
    const w = await world();
    const memClock = { ms: T0 };
    const memReader = new FixtureChainReader(FIXTURE_CHOGS);
    const memFeed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), () => memClock.ms);
    const memory = new MemoryCouncil({ reader: memReader, feed: memFeed, chogs: FIXTURE_CHOGS, now: () => memClock.ms });
    await memory.start();
    const both = async (action: (target: PgCult | MemoryCouncil) => Promise<unknown>) => {
      const [a, b] = await Promise.all([action(w.cult), action(memory)]);
      expect(a).toEqual(b);
    };
    for (const [holder, chog, faction] of [["alice", "Regent", "crown"], ["bob", "Banker", "crown"], ["dave", "Ember", "chaos"], ["erin", "Glitch", "chaos"]] as const) {
      await both((target) => target.setMembership(FIXTURE_HOLDERS[holder], key(chog), { faction }));
    }
    for (let cycle = 0; cycle < 4; cycle++) {
      for (const phase of PHASES) {
        if (cycle === 0 && phase === "propose") continue;
        await nextPhase(w);
        memClock.ms = w.clock.ms;
        await memory.advance();
        if (phase === "debate" || phase === "vote") { w.feed.runTicks(4); memFeed.runTicks(4); }
        if (cycle === 1 && phase === "vote") {
          await both((target) => target.override(FIXTURE_HOLDERS.alice, key("Regent"), "plaza", "golden-lanterns"));
          await both((target) => target.setMembership(FIXTURE_HOLDERS.erin, key("Glitch"), { stance: "abstain" }));
        }
        if (cycle === 2 && phase === "vote") {
          w.reader.transfer(chogByName("Banker").identity, FIXTURE_HOLDERS.hank);
          memReader.transfer(chogByName("Banker").identity, FIXTURE_HOLDERS.hank);
          await both((target) => target.override(FIXTURE_HOLDERS.bob, key("Banker"), "tavern", "noble-supper"));
        }
        if (cycle === 3 && phase === "debate") { w.feed.setDown(true); memFeed.setDown(true); }
      }
      expect(await w.cult.result(cycle)).toEqual(memory.result(cycle));
    }
    expect(await w.cult.reputation()).toEqual(memory.reputation);
    const banker = await w.cult.member(key("Banker"));
    expect(banker).toMatchObject({ faction: null, ownershipEpoch: "2", history: [{ faction: "crown", fromCycle: 0, toCycle: 2 }] });
    const types = (await w.cult.events()).map((event) => event.type);
    expect(types).toContain("city_gap");
    expect(types).toContain("place_control_changed");
  });

  it("survives a restart mid-vote and keeps overrides", async () => {
    const { schema, pool } = await freshSchema();
    const first = await world({ schema: { pool } });
    await first.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "crown" });
    await toPhase(first, 1, "vote");
    expect(await first.cult.override(FIXTURE_HOLDERS.alice, key("Regent"), "plaza", "hour-of-silence")).toMatchObject({ ok: true });

    // A new process: new pool, new service, same database.
    const restarted = await world({ schema: { pool: poolFor(schema) } });
    restarted.clock.ms = first.clock.ms;
    expect(await restarted.cult.runtime()).toEqual(await first.cult.runtime());
    await toPhase(restarted, 1, "resolve");
    const result = await restarted.cult.result(1);
    expect(result?.places.plaza.control).toEqual({ faction: "crown", decreeId: "hour-of-silence", sinceCycle: 2 });
  });

  it("lets only one of several racing schedulers apply a transition, including resolution", async () => {
    const { pool } = await freshSchema();
    const w = await world({ schema: { pool } });
    await w.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "crown" });
    await toPhase(w, 1, "vote");
    w.clock.ms = (await w.cult.runtime()).nextBoundaryAtMs;

    // Each racer reads the runtime row, then blocks in its first ownership read until all three have
    // arrived there, so every racer captured the same runtime before any of them takes the lock.
    const racers = 3;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedReader = {
      resolveAgent: async (identity: Parameters<typeof w.reader.resolveAgent>[0]) => {
        if (++arrived === racers * FIXTURE_CHOGS.length) release();
        await gate;
        return w.reader.resolveAgent(identity);
      },
    };
    const schedulers = Array.from({ length: racers }, () => new PgCult({ pool, reader: gatedReader, feed: w.feed, now: () => w.clock.ms }));
    const outcomes = await Promise.all(schedulers.map((scheduler) => scheduler.step()));
    expect(outcomes.filter((outcome) => outcome.kind === "advanced")).toEqual([{ kind: "advanced", cycle: 1, phase: "resolve" }]);
    expect(outcomes.filter((outcome) => outcome.kind === "stale")).toHaveLength(racers - 1);
    expect((await pool.query("SELECT count(*)::int AS n FROM cycle_results WHERE cycle = 1")).rows[0].n).toBe(1);
    expect(await w.cult.reputation()).toEqual({ [key("Regent")]: { loyalty: 1, glory: 3 } });
    const revisions = (await w.cult.events()).map((event) => BigInt(event.revision));
    expect(revisions).toEqual(revisions.map((_, index) => BigInt(index + 1)));
  });

  it("records downtime as a gap instead of simulating skipped cycles", async () => {
    const w = await world();
    w.clock.ms = T0 + 50 * PHASES.reduce((sum, phase) => sum + phaseMs(phase), 0);
    expect(await w.cult.runDue()).toEqual([{ kind: "advanced", cycle: 0, phase: "debate" }, { kind: "not_due", nextBoundaryAtMs: w.clock.ms + phaseMs("debate") }]);
    const gap = (await w.cult.events()).find((event) => event.type === "schedule_gap");
    expect(gap?.payload).toMatchObject({ overdueMs: w.clock.ms - (T0 + phaseMs("propose")) });
    expect((await w.cult.runtime()).cycle).toBe(0);
  });

  it("refuses the seller after a sale but still records the sale it detected", async () => {
    const w = await world();
    await w.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "crown" });
    w.reader.transfer(chogByName("Regent").identity, FIXTURE_HOLDERS.hank);
    expect(await w.cult.setMembership(FIXTURE_HOLDERS.alice, key("Regent"), { faction: "chaos" })).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    expect(await w.cult.member(key("Regent"))).toMatchObject({ faction: null, ownershipEpoch: "2" });
    w.reader.setUnavailable(chogByName("Regent").identity, true);
    expect(await w.cult.setMembership(FIXTURE_HOLDERS.hank, key("Regent"), { faction: "chaos" })).toMatchObject({ ok: false, code: "OWNERSHIP_UNAVAILABLE" });
    w.reader.setUnavailable(chogByName("Regent").identity, false);
    expect(await w.cult.setMembership(FIXTURE_HOLDERS.hank, key("Regent"), { faction: "chaos" })).toMatchObject({ ok: true, value: { faction: "chaos" } });
  });
});
