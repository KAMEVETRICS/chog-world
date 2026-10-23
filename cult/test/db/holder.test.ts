import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Wallet } from "ethers";
import { buildServer } from "../../src/api/server.js";
import type { AuthConfig } from "../../src/api/auth.js";
import { PgCult } from "../../src/db/pgCult.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FIXTURE_CHOGS, chogByName } from "../../src/fixture/chogs.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const ORIGIN = "http://127.0.0.1:5173";
const AUTH: AuthConfig = { domain: "127.0.0.1:5173", origin: ORIGIN, uri: ORIGIN, chainIds: [31337], secureCookies: false, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function setup() {
  const { pool } = await freshSchema();
  // Real test keys as holders, so sign-in uses real signatures. Local only; never funded.
  const wallets = FIXTURE_CHOGS.map(() => new Wallet(`0x${randomBytes(32).toString("hex")}`));
  const chogs = FIXTURE_CHOGS.map((chog, index) => ({ ...chog, owner: wallets[index]!.address.toLowerCase() }));
  const clock = { ms: Date.UTC(2026, 9, 20) };
  const reader = new FixtureChainReader(chogs);
  const feed = new FakeCityFeed(chogs.map((chog) => chog.agentKey), () => clock.ms);
  const cult = new PgCult({ pool, reader, feed, now: () => clock.ms });
  await cult.initialize("demo");
  await cult.registerChogs(chogs);
  const app = await buildServer({ pool, cult, auth: AUTH, now: () => clock.ms, sse: { pollMs: 1000 } });
  apps.push(app);
  const holder = (name: string) => wallets[FIXTURE_CHOGS.findIndex((chog) => chog.name === name)]!;
  const step = async () => {
    clock.ms = (await cult.runtime()).nextBoundaryAtMs;
    expect((await cult.step()).kind).toBe("advanced");
  };
  return { pool, app, cult, reader, clock, holder, step };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function login(s: Setup, wallet: Wallet) {
  const challenge = await s.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: wallet.address, chainId: 31337 } });
  expect(challenge.statusCode).toBe(200);
  const { message } = challenge.json();
  const verified = await s.app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await wallet.signMessage(message) } });
  expect(verified.statusCode).toBe(200);
  const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
  return { cookie, csrf: verified.json().csrfToken as string, message };
}

function put(s: Setup, auth: { cookie: string; csrf: string }, url: string, payload: object, key = randomBytes(8).toString("hex"), headers: Record<string, string> = {}) {
  return s.app.inject({ method: "PUT", url, payload, headers: { cookie: auth.cookie, "x-csrf-token": auth.csrf, origin: ORIGIN, "idempotency-key": key, ...headers } });
}

const key = (name: string) => chogByName(name).agentKey;

describeDb("SIWE login", () => {
  it("opens a session for the signer and lists only the Chogs it holds", async () => {
    const s = await setup();
    const alice = s.holder("Regent");
    const session = await login(s, alice);
    expect(session.message).toContain(`Chain ID: 31337`);
    const me = (await s.app.inject({ url: "/api/me", headers: { cookie: session.cookie } })).json();
    expect(me).toMatchObject({ address: alice.address.toLowerCase(), chogs: [{ name: "Regent", faction: null, ownershipEpoch: "1", control: "verified" }] });
    expect((await s.app.inject({ url: "/api/me" })).statusCode).toBe(401);
  });

  it("refuses replayed, wrongly signed, tampered, expired and wrong-chain challenges", async () => {
    const s = await setup();
    const alice = s.holder("Regent");
    const verify = (message: string, signature: string) => s.app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature } });
    const first = await login(s, alice);
    expect((await verify(first.message, await alice.signMessage(first.message))).statusCode).toBe(401);

    const { message } = (await s.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: alice.address, chainId: 31337 } })).json();
    expect((await verify(message, await s.holder("Banker").signMessage(message))).json()).toMatchObject({ error: { code: "LOGIN_FAILED" } });
    const tampered = message.replace("Chain ID: 31337", "Chain ID: 1");
    expect((await verify(tampered, await alice.signMessage(tampered))).statusCode).toBe(401);
    s.clock.ms += AUTH.challengeTtlMs;
    expect((await verify(message, await alice.signMessage(message))).statusCode).toBe(401);

    const wrongChain = await s.app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: alice.address, chainId: 143 } });
    expect(wrongChain.json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
  });

  it("logs out the human session without changing the Chog", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    expect((await put(s, alice, `/api/cult/members/${key("Regent")}`, { faction: "crown", expectedEpoch: "1" })).statusCode).toBe(200);
    const logout = await s.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie: alice.cookie, "x-csrf-token": alice.csrf, origin: ORIGIN } });
    expect(logout.json()).toEqual({ loggedOut: true });
    expect(String(logout.headers["set-cookie"])).toContain("Max-Age=0");
    expect((await s.app.inject({ url: "/api/me", headers: { cookie: alice.cookie } })).statusCode).toBe(401);
    expect(await s.cult.member(key("Regent"))).toMatchObject({ faction: "crown", stance: "persona" });
  });
});

describeDb("holder actions", () => {
  it("require the exact origin, a session and its CSRF token", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    const url = `/api/cult/members/${key("Regent")}`;
    expect((await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, undefined, { origin: "https://evil.example" })).json()).toMatchObject({ error: { code: "ORIGIN_REJECTED" } });
    expect((await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, undefined, { "x-csrf-token": "0".repeat(64) })).json()).toMatchObject({ error: { code: "CSRF_FAILED" } });
    expect((await put(s, { cookie: "", csrf: alice.csrf }, url, { faction: "crown", expectedEpoch: "1" })).statusCode).toBe(401);
    expect((await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, "short")).json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect((await put(s, alice, url, { faction: "pirates", expectedEpoch: "1" })).json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect((await put(s, alice, url, { expectedEpoch: "1" })).statusCode).toBe(400);
  });

  it("replays a retried request, refuses a reused key with a new body, and changes state once", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    const url = `/api/cult/members/${key("Regent")}`;
    const first = await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, "retry-key-1");
    const again = await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, "retry-key-1");
    expect(first.statusCode).toBe(200);
    expect(again.json()).toEqual(first.json());
    expect((await s.cult.events()).filter((event) => event.type === "member_changed")).toHaveLength(1);
    const conflict = await put(s, alice, url, { faction: "chaos", expectedEpoch: "1" }, "retry-key-1");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: { code: "IDEMPOTENCY_CONFLICT" } });
    // A refused business rule is a final answer too: the same key replays the same refusal.
    const cooldown = await put(s, alice, url, { faction: "chaos", expectedEpoch: "1" }, "retry-key-2");
    expect(cooldown.json()).toMatchObject({ error: { code: "SWITCH_COOLDOWN" } });
    expect((await put(s, alice, url, { faction: "chaos", expectedEpoch: "1" }, "retry-key-2")).json().error.code).toBe("SWITCH_COOLDOWN");
  });

  it("does not record an ownership outage as the final answer for a key", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    const url = `/api/cult/members/${key("Regent")}`;
    s.reader.setUnavailable(chogByName("Regent").identity, true);
    const outage = await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, "outage-key");
    expect(outage.statusCode).toBe(503);
    expect(outage.json()).toMatchObject({ error: { code: "OWNERSHIP_UNAVAILABLE" } });
    s.reader.setUnavailable(chogByName("Regent").identity, false);
    expect((await put(s, alice, url, { faction: "crown", expectedEpoch: "1" }, "outage-key")).statusCode).toBe(200);
  });

  it("ends the seller's control on transfer and lets the buyer start fresh with the new epoch", async () => {
    const s = await setup();
    const seller = s.holder("Regent");
    const buyer = s.holder("Pilot");
    const alice = await login(s, seller);
    const url = `/api/cult/members/${key("Regent")}`;
    expect((await put(s, alice, url, { faction: "crown", expectedEpoch: "1" })).statusCode).toBe(200);
    s.reader.transfer(chogByName("Regent").identity, buyer.address);
    const refused = await put(s, alice, url, { stance: "abstain", expectedEpoch: "1" });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await s.app.inject({ url: "/api/me", headers: { cookie: alice.cookie } })).json().chogs).toEqual([]);

    const bob = await login(s, buyer);
    const mine = (await s.app.inject({ url: "/api/me", headers: { cookie: bob.cookie } })).json().chogs;
    expect(mine.find((chog: { name: string }) => chog.name === "Regent")).toMatchObject({ faction: null, ownershipEpoch: "2" });
    expect((await put(s, bob, url, { faction: "chaos", expectedEpoch: "1" })).json()).toMatchObject({ error: { code: "CONTROL_CHANGED" } });
    const joined = await put(s, bob, url, { faction: "chaos", expectedEpoch: "2" });
    expect(joined.json()).toMatchObject({ member: { faction: "chaos", ownershipEpoch: "2", history: [{ faction: "crown", fromCycle: 0, toCycle: 0 }, { faction: "chaos", fromCycle: 0, toCycle: null }] } });
  });

  it("accepts vote overrides only for the current cycle during the Vote phase", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    expect((await put(s, alice, `/api/cult/members/${key("Regent")}`, { faction: "crown", expectedEpoch: "1" })).statusCode).toBe(200);
    const vote = (cycle: number, decreeId: string | null) => put(s, alice, `/api/cult/votes/${cycle}/${key("Regent")}/plaza`, { decreeId, expectedEpoch: "1" });
    for (let index = 0; index < 5; index++) await s.step();
    expect((await vote(1, "golden-lanterns")).json()).toMatchObject({ error: { code: "VOTING_CLOSED" } });
    await s.step();
    expect((await vote(0, "golden-lanterns")).json()).toMatchObject({ error: { code: "VOTING_CLOSED" } });
    expect((await vote(1, "bell-riot")).json()).toMatchObject({ error: { code: "INVALID_INPUT" } });
    expect((await vote(1, "golden-lanterns")).json()).toMatchObject({ vote: { cycle: 1, place: "plaza", decreeId: "golden-lanterns", source: "holder" } });
    expect((await vote(1, null)).json()).toMatchObject({ vote: { decreeId: null } });
    await s.step();
    expect((await s.cult.result(1))?.places.plaza.outcome).toBe("no_contest");
  });

  it("limits each session to 10 changes per Chog per minute", async () => {
    const s = await setup();
    const alice = await login(s, s.holder("Regent"));
    const url = `/api/cult/members/${key("Regent")}`;
    const codes: number[] = [];
    for (let index = 0; index < 11; index++) codes.push((await put(s, alice, url, { stance: "abstain", expectedEpoch: "1" })).statusCode);
    expect(codes.slice(0, 10).every((code) => code !== 429)).toBe(true);
    expect(codes[10]).toBe(429);
    s.clock.ms += 60_000;
    expect((await put(s, alice, url, { stance: "abstain", expectedEpoch: "1" })).statusCode).not.toBe(429);
  });
});
