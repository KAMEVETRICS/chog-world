import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Wallet } from "ethers";
import { buildServer } from "../../src/api/server.js";
import type { AuthConfig } from "../../src/api/auth.js";
import { PgCult } from "../../src/db/pgCult.js";
import { RULESET_VERSION } from "../../src/citysim/world.js";
import { PgCity } from "../../src/citysim/pgCity.js";
import { PgCityFeed } from "../../src/citysim/cityFeed.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FixtureAgentDirectory } from "../../src/fixture/agentDirectory.js";
import { FixtureHoldingsIndex } from "../../src/chain/holdings.js";
import { ADAPTER } from "../../src/chain/evm.js";
import { makeAgentKey } from "../../src/shared/identity.js";
import { agentURIFor } from "../../src/soul/awakening.js";
import { FIXTURE_CHOGS, chogByName } from "../../src/fixture/chogs.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const ORIGIN = "http://127.0.0.1:5173";
const AUTH: AuthConfig = { domain: "127.0.0.1:5173", origin: ORIGIN, uri: ORIGIN, chainIds: [31337], secureCookies: false, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const key = (name: string) => chogByName(name).agentKey;

/**
 * `outside` names fixture Chogs that start outside City (and the Cult), for holders to bring in. `extras` adds
 * that many other residents, to fill City's plots.
 */
async function setup({ outside = [] as string[], extras = 0 } = {}) {
  const { pool } = await freshSchema();
  const wallets = FIXTURE_CHOGS.map(() => new Wallet(`0x${randomBytes(32).toString("hex")}`));
  const chogs = FIXTURE_CHOGS.map((chog, index) => ({ ...chog, owner: wallets[index]!.address.toLowerCase() }));
  const clock = { ms: Date.UTC(2026, 9, 20, 12) };
  const others = Array.from({ length: extras }, (_, index) => {
    const identity = { ...FIXTURE_CHOGS[0]!.identity, tokenId: String(500 + index), agentId: String(600 + index) };
    return { name: `Extra ${index + 1}`, identity, agentKey: makeAgentKey(identity), traits: {}, owner: "0x00000000000000000000000000000000000000e1" };
  });
  const reader = new FixtureChainReader([...chogs, ...others]);
  const cult = new PgCult({ pool, reader, feed: new PgCityFeed(pool), now: () => clock.ms });
  await cult.initialize("demo");
  await cult.registerChogs(chogs.filter((chog) => !outside.includes(chog.name)));
  const city = new PgCity({ pool, reader, now: () => clock.ms });
  await city.initialize();
  await city.admitRoster([...chogs.filter((chog) => !outside.includes(chog.name)), ...others]);
  const app = await buildServer({
    pool, cult, city, cityDirectory: new FixtureAgentDirectory(chogs), holdings: new FixtureHoldingsIndex(chogs, reader),
    awaken: { chainId: 31337, adapter: chogs[0]!.identity.adapter }, auth: AUTH, now: () => clock.ms, sse: { pollMs: 25, heartbeatMs: 60_000 } });
  apps.push(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const holder = (name: string) => wallets[FIXTURE_CHOGS.findIndex((chog) => chog.name === name)]!;
  const tick = async (count = 1) => {
    for (let index = 0; index < count; index++) {
      clock.ms = (await city.runtime()).nextDueAtMs;
      expect((await city.step()).kind).toBe("advanced");
    }
  };
  return { pool, app, address, city, reader, clock, holder, tick };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function login(s: Setup, wallet: Wallet) {
  const { message } = (await s.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: wallet.address, chainId: 31337 } })).json();
  const verified = await s.app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await wallet.signMessage(message) } });
  return { cookie: String(verified.headers["set-cookie"]).split(";")[0]!, csrf: verified.json().csrfToken as string };
}

function patch(s: Setup, session: { cookie: string; csrf: string }, agentKey: string, payload: object, idempotencyKey = randomBytes(8).toString("hex"), headers: Record<string, string> = {}) {
  return s.app.inject({ method: "PATCH", url: `/api/city/agents/${agentKey}/policy`, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: ORIGIN, "idempotency-key": idempotencyKey, ...headers } });
}

describeDb("City public API", () => {
  it("serves a snapshot in City's contract shape, and single residents", async () => {
    const s = await setup();
    await s.tick(2);
    const config = (await s.app.inject({ url: "/api/cult/config" })).json();
    expect(config).toMatchObject({ city: true, login: true });
    const snapshot = (await s.app.inject({ url: "/api/city/snapshot" })).json();
    expect(snapshot).toMatchObject({ tick: "2", nextDueAt: expect.any(String), world: { tick: "2", rulesetVersion: RULESET_VERSION } });
    expect(snapshot.world.places).toHaveLength(6);
    expect(snapshot.world.plots).toHaveLength(12);
    expect(snapshot.world.agents).toHaveLength(8);
    expect(snapshot.recentEvents.at(-1).revision).toBe(snapshot.revision);
    // Holders appear only as each Chog's on-chain controller; nothing from their sessions.
    expect(JSON.stringify(snapshot)).not.toMatch(/csrf|token_hash|session/i);
    const one = (await s.app.inject({ url: `/api/city/agents/${key("Regent")}` })).json();
    expect(one.agent).toMatchObject({ name: "Regent", plotId: expect.any(String), control: { controller: s.holder("Regent").address.toLowerCase() }, inventory: { wood: { total: expect.any(Number) } } });
    expect((await s.app.inject({ url: "/api/city/agents/nope" })).statusCode).toBe(400);
    expect((await s.app.inject({ url: `/api/city/agents/${key("Regent").replace(/:101$/, ":999")}` })).statusCode).toBe(404);
  });

  it("streams City events with replay from a cursor in the CityEvent envelope", async () => {
    const s = await setup();
    await s.tick(2);
    const abort = new AbortController();
    const response = await fetch(`${s.address}/api/city/events?after=0`, { signal: abort.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const latest = Number((await s.city.runtime()).revision);
    let ticked = false;
    while (!text.includes(`id: ${latest + 1}\n`)) {
      // Once the replay reaches the latest revision, a new tick must arrive live.
      if (text.includes(`id: ${latest}\n`) && !ticked) { ticked = true; await s.tick(); }
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    abort.abort();
    const ids = [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids.slice(0, latest + 1)).toEqual(Array.from({ length: latest + 1 }, (_, index) => index + 1));
    const tick = text.split("\n\n").find((frame) => frame.includes("event: city_tick"))!;
    expect(JSON.parse(tick.split("data: ")[1]!)).toMatchObject({ type: "city_tick", data: { tick: "1", activities: expect.any(Array) }, createdAt: expect.any(String) });
  });
});

describeDb("City UI", () => {
  it("is served at /city/ from City's server build, and the server refuses to start without one", async () => {
    const { pool } = await freshSchema();
    const root = mkdtempSync(join(tmpdir(), "city-ui-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>Chog City</title><script type=\"module\" src=\"/city/assets/index.js\"></script>");
    writeFileSync(join(root, "assets", "index.js"), "console.log(1);");
    const reader = new FixtureChainReader(FIXTURE_CHOGS);
    const city = new PgCity({ pool, reader });
    await city.initialize();
    const app = await buildServer({ pool, city, cityWebRoot: root });
    apps.push(app);
    const page = await app.inject({ url: "/city/" });
    expect([page.statusCode, page.headers["content-type"]]).toEqual([200, "text/html; charset=utf-8"]);
    expect(page.body).toContain("<title>Chog City</title>");
    expect((await app.inject({ url: "/city/assets/index.js" })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/city/snapshot" })).statusCode).toBe(200);
    await expect(buildServer({ pool, city, cityWebRoot: join(root, "missing") })).rejects.toThrow(/run build:server/);
  });
});

describeDb("Bringing a Chog into City", () => {
  it("lets a signed-in holder bring their own awakened Chog in by token ID, once, and lists their residents", async () => {
    const s = await setup({ outside: ["Regent", "Banker"] });
    const alice = await login(s, s.holder("Regent"));
    const admit = (tokenId: string, headers: Record<string, string> = {}) => s.app.inject({
      method: "POST", url: "/api/city/admissions", payload: { tokenId }, headers: { cookie: alice.cookie, "x-csrf-token": alice.csrf, origin: ORIGIN, ...headers },
    });
    expect((await s.app.inject({ method: "POST", url: "/api/city/admissions", payload: { tokenId: "1" }, headers: { origin: ORIGIN } })).json()).toMatchObject({ error: { code: "LOGIN_REQUIRED" } });
    expect((await admit("1", { origin: "https://evil.example" })).json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect((await admit("1", { "x-csrf-token": "0".repeat(64) })).json()).toMatchObject({ error: { code: "CSRF_FAILED" } });
    expect((await admit("01")).statusCode).toBe(400);
    const asleep = await admit("77");
    expect([asleep.statusCode, asleep.json().error.code]).toEqual([409, "NOT_AWAKENED"]);
    const notHers = await admit("2");
    expect([notHers.statusCode, notHers.json().error.code]).toEqual([403, "NOT_CONTROLLER"]);
    expect((await s.app.inject({ url: "/api/city/me/agents", headers: { cookie: alice.cookie } })).json()).toEqual({ address: s.holder("Regent").address.toLowerCase(), agents: [] });
    const brought = await admit("1");
    expect(brought.statusCode).toBe(200);
    expect(brought.json()).toMatchObject({ agent: { key: key("Regent"), name: "Regent", plotId: "p07", policy: { active: true, version: "1" }, control: { controller: s.holder("Regent").address.toLowerCase() } } });
    expect((await admit("1")).json()).toEqual(brought.json());
    // Bringing a Chog into City also makes it a Cult member, unaligned until its holder picks a faction.
    expect((await s.app.inject({ url: `/api/cult/agents/${key("Regent")}` })).json().member).toMatchObject({ agentKey: key("Regent"), faction: null });
    expect((await s.app.inject({ url: `/api/cult/agents/${key("Banker")}` })).statusCode).toBe(404);
    const mine = (await s.app.inject({ url: "/api/city/me/agents", headers: { cookie: alice.cookie } })).json();
    expect(mine.agents.map((agent: { key: string }) => agent.key)).toEqual([key("Regent")]);
    expect((await s.app.inject({ url: "/api/city/me/agents" })).statusCode).toBe(401);
    const admitted = (await s.app.inject({ url: "/api/city/snapshot" })).json().recentEvents.filter((event: { type: string }) => event.type === "resident_admitted");
    expect(admitted.at(-1).data).toMatchObject({ agentKey: key("Regent"), plotId: "p07" });
  });
});

describeDb("Chog Soul: your Chogs and awakening", () => {
  it("lists the signed-in holder's Chogs and where they live, checks a token fresh, and prepares an awakening", async () => {
    const s = await setup({ outside: ["Regent"] });
    const alice = await login(s, s.holder("Regent"));
    const get = (url: string, cookie?: string) => s.app.inject({ url, ...(cookie ? { headers: { cookie } } : {}) });
    expect((await get("/api/soul/holdings")).statusCode).toBe(401);
    const before = (await get("/api/soul/holdings", alice.cookie)).json();
    expect(before).toEqual({
      address: s.holder("Regent").address.toLowerCase(), blockNumber: "0", awakening: true,
      chogs: [{ tokenId: "1", name: "Chog #1", image: expect.stringMatching(/^https:\/\/.+\.webp$/), awakened: true, agentKey: key("Regent"), inCult: false, inCity: false, plotId: null }],
    });
    // Before it joins, a Chog is known by its token number; afterwards by its Cult name.

    expect((await get("/api/soul/tokens/1")).json()).toEqual({ tokenId: "1", awakened: true, agentKey: key("Regent") });
    expect((await get("/api/soul/tokens/77")).json()).toEqual({ tokenId: "77", awakened: false, agentKey: null });
    expect((await get("/api/soul/tokens/abc")).statusCode).toBe(400);

    const awake = await get("/api/soul/awaken/1");
    expect([awake.statusCode, awake.json().error.code]).toEqual([409, "ALREADY_AWAKENED"]);
    const plan = (await get("/api/soul/awaken/77")).json();
    expect(plan).toMatchObject({ chainId: 31337, to: FIXTURE_CHOGS[0]!.identity.adapter, agentURI: agentURIFor("77") });
    expect(ADAPTER.parseTransaction({ data: plan.data })!.args.map(String)).toEqual(["77", agentURIFor("77")]);

    const brought = await s.app.inject({ method: "POST", url: "/api/city/admissions", payload: { tokenId: "1" }, headers: { cookie: alice.cookie, "x-csrf-token": alice.csrf, origin: ORIGIN } });
    expect(brought.statusCode).toBe(200);
    expect((await get("/api/soul/holdings", alice.cookie)).json().chogs).toEqual([
      expect.objectContaining({ tokenId: "1", name: "Regent", inCult: true, inCity: true, plotId: "p08" }),
    ]);
  });

  it("still lets a Chog join the Cult and its Soul when every City plot is taken", async () => {
    const s = await setup({ outside: ["Regent"], extras: 5 });
    const alice = await login(s, s.holder("Regent"));
    const full = await s.app.inject({ method: "POST", url: "/api/city/admissions", payload: { tokenId: "1" }, headers: { cookie: alice.cookie, "x-csrf-token": alice.csrf, origin: ORIGIN } });
    expect([full.statusCode, full.json().error.code]).toEqual([409, "CITY_FULL"]);
    expect(full.json().error.message).toMatch(/joined Chog Cult and Chog Soul/);
    expect((await s.app.inject({ url: `/api/cult/agents/${key("Regent")}` })).json().member).toMatchObject({ agentKey: key("Regent"), faction: null });
    expect((await s.app.inject({ url: "/api/soul/holdings", headers: { cookie: alice.cookie } })).json().chogs[0]).toMatchObject({ inCult: true, inCity: false });
    // Someone else's Chog never joins through a full City.
    const bob = await login(s, s.holder("Banker"));
    const notHis = await s.app.inject({ method: "POST", url: "/api/city/admissions", payload: { tokenId: "1" }, headers: { cookie: bob.cookie, "x-csrf-token": bob.csrf, origin: ORIGIN } });
    expect(notHis.json().error.code).toBe("NOT_CONTROLLER");
  });
});

describeDb("City holder settings API", () => {
  it("needs the origin, CSRF token and an idempotency key, and saves only for the holder", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    const body = { expectedVersion: "1", expectedEpoch: "1", active: true, focus: "social", homeStyle: "treehouse" };
    expect((await patch(s, alice, key("Regent"), body, undefined, { origin: "https://evil.example" })).json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect((await patch(s, alice, key("Regent"), body, undefined, { "x-csrf-token": "0".repeat(64) })).json()).toMatchObject({ error: { code: "CSRF_FAILED" } });
    expect((await patch(s, alice, key("Regent"), body, "short")).statusCode).toBe(400);
    expect((await patch(s, alice, key("Regent"), { ...body, focus: "dancer" })).statusCode).toBe(400);
    expect((await patch(s, alice, key("Banker"), body)).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    const saved = await patch(s, alice, key("Regent"), body, "city-key-01");
    expect(saved.json()).toMatchObject({ agent: { key: key("Regent"), policy: { active: true, focus: "social", homeStyle: "treehouse", version: "2" } } });
    expect((await patch(s, alice, key("Regent"), body, "city-key-01")).json()).toEqual(saved.json());
    const stale = await patch(s, alice, key("Regent"), body);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "POLICY_CHANGED" } });
  });

  it("refuses the seller after a sale and lets the buyer start the Chog again", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    s.reader.transfer(chogByName("Regent").identity, s.holder("Pilot").address);
    const body = { expectedVersion: "1", expectedEpoch: "1", active: true, focus: "gatherer", homeStyle: "cottage" };
    expect((await patch(s, alice, key("Regent"), body)).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    const snapshot = (await s.app.inject({ url: "/api/city/snapshot" })).json();
    const regent = snapshot.world.agents.find((agent: { name: string }) => agent.name === "Regent");
    expect(regent).toMatchObject({ control: { epoch: "2" }, policy: { active: false, version: "2" } });
    const bob = await login(s, s.holder("Pilot"));
    expect((await patch(s, bob, key("Regent"), body)).json()).toMatchObject({ error: { code: "CONTROL_CHANGED" } });
    expect((await patch(s, bob, key("Regent"), { ...body, expectedEpoch: "2", expectedVersion: "2" })).json()).toMatchObject({ agent: { policy: { active: true, focus: "gatherer", homeStyle: "cottage", version: "3" } } });
  });
});

function decorate(s: Setup, session: { cookie: string; csrf: string }, agentKey: string, payload: object, idempotencyKey = randomBytes(8).toString("hex")) {
  return s.app.inject({ method: "POST", url: `/api/city/agents/${agentKey}/decor`, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: ORIGIN, "idempotency-key": idempotencyKey } });
}

describeDb("City needs and home decorating", () => {
  it("stores needs as the village runs; residents eat from their ledgered stores", async () => {
    const s = await setup();
    const before = (await s.app.inject({ url: `/api/city/agents/${key("Regent")}` })).json().agent;
    expect(before).toMatchObject({ needs: { energy: 80, hunger: 80, fun: 80, social: 80 }, decor: [] });
    await s.tick(20);
    const after = (await s.app.inject({ url: `/api/city/agents/${key("Regent")}` })).json().agent;
    expect(after.needs).not.toEqual(before.needs);
    const { rows } = await s.pool.query("SELECT count(*)::int AS n FROM city_ledger WHERE reason = 'eat'");
    expect(rows[0].n).toBeGreaterThan(0);
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("lets the holder buy a decoration from the Chog's stores, once, and publishes it", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    expect((await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "throne" })).statusCode).toBe(400);
    expect((await decorate(s, alice, key("Banker"), { expectedEpoch: "1", item: "lantern" })).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await decorate(s, alice, key("Regent"), { expectedEpoch: "9", item: "lantern" })).json()).toMatchObject({ error: { code: "CONTROL_CHANGED" } });
    const bought = await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "lantern" }, "decor-key-01");
    expect(bought.json()).toMatchObject({ agent: { decor: ["lantern"], inventory: { wood: { total: 2, reserved: 0 } } } });
    expect((await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "lantern" }, "decor-key-01")).json()).toEqual(bought.json());
    expect((await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "bench" }, "decor-key-01")).json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    const again = await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "lantern" });
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: "ALREADY_OWNED" } });
    expect((await decorate(s, alice, key("Regent"), { expectedEpoch: "1", item: "well" })).json()).toMatchObject({ error: { code: "CANT_AFFORD" } });

    const { rows } = await s.pool.query("SELECT data FROM city_events WHERE type = 'home_decorated'");
    expect(rows.map((row) => row.data.changes)).toEqual([[{ type: "decorated", agentKey: key("Regent"), item: "lantern" }]]);
    // A decoration stays with the home when the Chog changes hands, and keeps the books balanced.
    s.reader.transfer(chogByName("Regent").identity, s.holder("Pilot").address);
    await s.tick();
    expect((await s.app.inject({ url: `/api/city/agents/${key("Regent")}` })).json().agent.decor).toEqual(["lantern"]);
    expect(await s.city.reconcile()).toEqual([]);
  });
});

function send(s: Setup, method: "POST" | "PATCH", url: string, session: { cookie: string; csrf: string } | null, payload: object, idempotencyKey: string | null = randomBytes(8).toString("hex")) {
  const headers: Record<string, string> = { origin: ORIGIN, ...(session ? { cookie: session.cookie, "x-csrf-token": session.csrf } : {}), ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) };
  return s.app.inject({ method, url, payload, headers });
}

const LOOK = { Skin: "Green", Head: "Beanie", Body: "Vest", Eyes: "Happy" };

describeDb("City citizens and economy on the server", () => {
  it("lets a wallet with no Chog join, work for the city and get paid, with balanced books", async () => {
    const s = await setup();
    expect((await s.app.inject({ url: "/api/cult/config" })).json()).toMatchObject({ city: true, citizens: true });
    const wallet = new Wallet(`0x${randomBytes(32).toString("hex")}`);
    const me = await login(s, wallet);
    expect((await s.app.inject({ url: "/api/city/citizens/me", headers: { cookie: me.cookie } })).json()).toEqual({ citizen: null });
    expect((await send(s, "POST", "/api/city/citizens", null, { name: "Clover", look: LOOK })).statusCode).toBe(401);
    expect((await send(s, "POST", "/api/city/citizens", me, { name: "Clover", look: LOOK }, null)).statusCode).toBe(400);
    expect((await send(s, "POST", "/api/city/citizens", me, { name: "x", look: LOOK })).json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect((await send(s, "POST", "/api/city/citizens", me, { name: "Clover", look: { ...LOOK, Skin: "Gold" } })).statusCode).toBe(400);
    const joined = await send(s, "POST", "/api/city/citizens", me, { name: "Clover", look: LOOK }, "join-key-01");
    expect(joined.json()).toMatchObject({ citizen: { name: "Clover", address: wallet.address.toLowerCase(), lotId: "c01", coins: 10, job: "off" } });
    expect((await send(s, "POST", "/api/city/citizens", me, { name: "Clover", look: LOOK }, "join-key-01")).json()).toEqual(joined.json());

    expect((await send(s, "PATCH", "/api/city/citizens/me/job", me, { expectedVersion: "9", job: "farmhand" })).json()).toMatchObject({ error: { code: "JOB_CHANGED" } });
    expect((await send(s, "PATCH", "/api/city/citizens/me/job", me, { expectedVersion: "1", job: "farmhand" })).json()).toMatchObject({ citizen: { job: "farmhand", jobVersion: "2" } });
    await s.tick();
    const snapshot = (await s.app.inject({ url: "/api/city/snapshot" })).json();
    expect(snapshot.world.citizens).toEqual([expect.objectContaining({ name: "Clover", coins: 14, location: { kind: "place", placeId: "farm" } })]);
    expect(snapshot.world.treasury).toEqual({ coins: 101, stores: { wood: 0, stone: 0, food: 3 } });
    expect(snapshot.world.params).toMatchObject({ version: "1", values: { wage: 5, incomeTaxPct: 20, marketFeePct: 10 } });
    expect(snapshot.recentEvents.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["citizen_joined", "job_changed"]));
    expect(await s.city.reconcile()).toEqual([]);
  });

  it("runs the market, hiring, gifts and projects for holders and citizens, fenced by ownership", async () => {
    const s = await setup();
    const regent = key("Regent");
    const alice = await login(s, s.holder("Regent"));
    const act = (session: { cookie: string; csrf: string }, action: object, idem?: string) => send(s, "POST", "/api/city/actions", session, action, idem);
    expect((await act(alice, { type: "trade", chog: regent, expectedEpoch: "1", side: "sell", resource: "wood", amount: 2 }, "trade-key-01")).json()).toEqual({ ok: true });
    expect((await act(alice, { type: "trade", chog: regent, expectedEpoch: "1", side: "sell", resource: "wood", amount: 2 }, "trade-key-01")).json()).toEqual({ ok: true });
    expect((await act(alice, { type: "trade", chog: regent, expectedEpoch: "1", side: "sell", resource: "wood", amount: 9 })).json()).toMatchObject({ error: { code: "NOT_ENOUGH" } });
    expect((await act(alice, { type: "trade", chog: key("Banker"), expectedEpoch: "1", side: "sell", resource: "wood", amount: 1 })).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await act(alice, { type: "steal", chog: regent })).statusCode).toBe(400);
    expect((await s.app.inject({ url: `/api/city/agents/${regent}` })).json().agent).toMatchObject({ coins: 10, inventory: { wood: { total: 2 } } });

    expect((await act(alice, { type: "offer", chog: regent, expectedEpoch: "1", offer: { job: "quarrier", wage: 3 } })).json()).toEqual({ ok: true });
    const wallet = new Wallet(`0x${randomBytes(32).toString("hex")}`);
    const bob = await login(s, wallet);
    await send(s, "POST", "/api/city/citizens", bob, { name: "Basil", look: LOOK });
    expect((await act(bob, { type: "take_offer", employer: regent })).json()).toEqual({ ok: true });
    await s.tick();
    const after = (await s.app.inject({ url: "/api/city/snapshot" })).json().world;
    expect(after.agents.find((a: { key: string }) => a.key === regent)).toMatchObject({ coins: 7, inventory: { stone: { total: 4 } } });
    expect(after.citizens[0]).toMatchObject({ name: "Basil", employer: regent, coins: 13 });

    expect((await act(bob, { type: "gift", from: { kind: "citizen" }, to: regent, asset: "coins", amount: 2 })).json()).toEqual({ ok: true });
    expect((await act(bob, { type: "contribute", projectId: "fountain", from: { kind: "citizen" }, asset: "coins", amount: 5 })).json()).toEqual({ ok: true });
    expect((await act(alice, { type: "contribute", projectId: "fountain", from: { kind: "chog", key: regent, expectedEpoch: "1" }, asset: "stone", amount: 2 })).json()).toEqual({ ok: true });
    expect((await s.app.inject({ url: "/api/city/snapshot" })).json().world.projects.fountain).toEqual({ given: { wood: 0, stone: 2, food: 0, coins: 5 }, completedTick: null });

    // After a sale the old holder can no longer spend from the Chog; its offer is dropped and the citizen goes back to the city.
    s.reader.transfer(chogByName("Regent").identity, s.holder("Pilot").address);
    expect((await act(alice, { type: "trade", chog: regent, expectedEpoch: "1", side: "sell", resource: "food", amount: 1 })).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    await s.tick();
    const sold = (await s.app.inject({ url: "/api/city/snapshot" })).json().world;
    expect(sold.agents.find((a: { key: string }) => a.key === regent)).toMatchObject({ coins: 9, offer: null, control: { epoch: "2" } });
    expect(sold.citizens[0].employer).toBeNull();
    expect(await s.city.reconcile()).toEqual([]);
  });
});

describeDb("City votes on the server", () => {
  it("a holder proposes through their Chog, a citizen votes, and the change applies when the vote closes", async () => {
    const s = await setup();
    const regent = key("Regent");
    const alice = await login(s, s.holder("Regent"));
    const act = (session: { cookie: string; csrf: string }, action: object) => send(s, "POST", "/api/city/actions", session, action);
    const wallet = new Wallet(`0x${randomBytes(32).toString("hex")}`);
    const bob = await login(s, wallet);
    await send(s, "POST", "/api/city/citizens", bob, { name: "Basil", look: LOOK });

    const proposal = { type: "propose", chog: regent, expectedEpoch: "1", title: "Higher wages", change: { kind: "params", values: { wage: 7 } } };
    expect((await act(bob, proposal)).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await act(alice, { ...proposal, change: { kind: "params", values: { wage: 10 } } })).json()).toMatchObject({ error: { code: "NOT_ALLOWED" } });
    expect((await act(alice, proposal)).json()).toEqual({ ok: true });
    expect((await act(alice, proposal)).json()).toMatchObject({ error: { code: "TOO_MANY_PROPOSALS" } });
    expect((await act(bob, { type: "vote", proposalId: "p1", ballot: "yes" })).json()).toMatchObject({ error: { code: "CANT_VOTE_YET" } });
    // Stand-in for three village days of work.
    await s.pool.query("UPDATE city_citizens SET active_days = 3");
    expect((await act(bob, { type: "vote", proposalId: "p1", ballot: "yes" })).json()).toEqual({ ok: true });
    expect((await s.app.inject({ url: "/api/city/snapshot" })).json().world.proposals[0]).toMatchObject({ id: "p1", status: "open", votes: { [`citizen:${wallet.address.toLowerCase()}`]: "yes" } });

    await s.tick(36);
    const world = (await s.app.inject({ url: "/api/city/snapshot" })).json().world;
    expect(world.proposals[0]).toMatchObject({ status: "passed", resolvedTick: "36" });
    expect(world.params).toMatchObject({ version: "2", values: { wage: 7 } });
    expect((await act(bob, { type: "vote", proposalId: "p1", ballot: "no" })).json()).toMatchObject({ error: { code: "VOTE_CLOSED" } });
    expect(await s.city.reconcile()).toEqual([]);
  });
});
