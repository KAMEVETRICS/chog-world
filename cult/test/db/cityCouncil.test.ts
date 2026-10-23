import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Wallet } from "ethers";
import { buildServer } from "../../src/api/server.js";
import type { AuthConfig } from "../../src/api/auth.js";
import { PgCult } from "../../src/db/pgCult.js";
import { PgCity } from "../../src/citysim/pgCity.js";
import { PgCityFeed } from "../../src/citysim/cityFeed.js";
import { CityCouncil } from "../../src/citysim/council.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FIXTURE_CHOGS, chogByName } from "../../src/fixture/chogs.js";
import { parseChog } from "../../src/soul/config.js";
import { PgCredits } from "../../src/soul/credits.js";
import type { ModelProvider, ModelRequest, ModelResult } from "../../src/soul/provider.js";
import { SoulService } from "../../src/soul/service.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const ORIGIN = "http://127.0.0.1:5173";
const AUTH: AuthConfig = { domain: "127.0.0.1:5173", origin: ORIGIN, uri: ORIGIN, chainIds: [31337], secureCookies: false, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
const key = (name: string) => chogByName(name).agentKey;

class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: ModelRequest[] = [];
  constructor(private readonly answer: (request: ModelRequest) => string) {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
    return { text: this.answer(request), model: "fake/model", promptTokens: 400, completionTokens: 60, costUsd: 0.0001 };
  }
}

async function setup(provider: ModelProvider | null = null) {
  const { pool } = await freshSchema();
  const wallets = FIXTURE_CHOGS.map(() => new Wallet(`0x${randomBytes(32).toString("hex")}`));
  const chogs = FIXTURE_CHOGS.map((chog, index) => ({ ...chog, owner: wallets[index]!.address.toLowerCase() }));
  const clock = { ms: Date.UTC(2026, 9, 22, 12) };
  const reader = new FixtureChainReader(chogs);
  const credits = new PgCredits(pool, () => clock.ms);
  const soul = new SoulService({ pool, credits, provider, reader, now: () => clock.ms });
  const cult = new PgCult({ pool, reader, feed: new PgCityFeed(pool), now: () => clock.ms, soul });
  await cult.initialize("demo");
  await cult.registerChogs(chogs);
  const city = new PgCity({ pool, reader, now: () => clock.ms });
  await city.initialize();
  await city.admitRoster(chogs);
  const app = await buildServer({ pool, cult, city, auth: AUTH, now: () => clock.ms, sse: { pollMs: 25, heartbeatMs: 60_000 } });
  apps.push(app);
  const holder = (name: string) => wallets[FIXTURE_CHOGS.findIndex((chog) => chog.name === name)]!;
  /** Runs City to its next council tick (hour 2 of the village day). */
  const toCouncil = async () => {
    do {
      clock.ms = (await city.runtime()).nextDueAtMs;
      await city.step();
    } while ((await city.councilPlan()) === null);
  };
  const login = async (wallet: Wallet) => {
    const { message } = (await app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: wallet.address, chainId: 31337 } })).json();
    const verified = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await wallet.signMessage(message) } });
    return { cookie: String(verified.headers["set-cookie"]).split(";")[0]!, csrf: verified.json().csrfToken as string };
  };
  return { pool, app, city, soul, credits, reader, holder, toCouncil, login };
}

describeDb("City council on the server", () => {
  it("keeps standing instructions private to the current holder and drops them on a sale", async () => {
    const s = await setup();
    const regent = key("Regent");
    const alice = await s.login(s.holder("Regent"));
    const bob = await s.login(s.holder("Pilot"));
    const put = (session: { cookie: string; csrf: string }, payload: object) =>
      s.app.inject({ method: "PUT", url: `/api/city/agents/${regent}/instructions`, payload, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: ORIGIN } });
    const get = (session: { cookie: string }) => s.app.inject({ url: `/api/city/agents/${regent}/instructions`, headers: { cookie: session.cookie } });
    expect((await get(alice)).json()).toEqual({ text: null });
    expect((await put(alice, { expectedEpoch: "1", text: "Please cut the income tax." })).json()).toEqual({ text: "Please cut the income tax." });
    expect((await get(alice)).json()).toEqual({ text: "Please cut the income tax." });
    expect((await get(bob)).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await put(bob, { expectedEpoch: "1", text: "mine" })).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await put(alice, { expectedEpoch: "1", text: "x".repeat(601) })).statusCode).toBe(400);
    s.reader.transfer(chogByName("Regent").identity, s.holder("Pilot").address);
    expect((await get(bob)).json()).toEqual({ text: null });
  });

  it("holds the morning council once with the rules-based mind: instructions become a proposal, Chogs debate", async () => {
    const s = await setup();
    const regent = key("Regent");
    await s.city.setInstructions(s.holder("Regent").address, regent, { expectedEpoch: "1", text: "Please cut the income tax." });
    await s.toCouncil();
    const council = new CityCouncil(s.city, null);
    const held = await council.runIfDue();
    expect(held).toMatchObject({ ai: 0 });
    expect(held!.spoke).toBeGreaterThan(1);
    expect(await council.runIfDue()).toBeNull();
    const snapshot = (await s.app.inject({ url: "/api/city/snapshot" })).json();
    const proposal = snapshot.world.proposals[0];
    expect(proposal).toMatchObject({ id: "p1", proposer: regent, title: "Income tax to 15 %", status: "open" });
    expect(proposal.speeches.length).toBeGreaterThan(1);
    expect(proposal.speeches.every((speech: { by: string }) => speech.by === "rules")).toBe(true);
    expect(snapshot.recentEvents.at(-1).type).toBe("council");
    expect(await s.city.reconcile()).toEqual([]);
    // Runs 34 City ticks against Postgres.
  }, 60_000);

  it("uses a Chog's AI when its holder opted in, charges only turns that counted, and checks what the AI says", async () => {
    const provider = new FakeProvider((request) =>
      request.messages[0]!.content.includes("Please raise wages")
        ? 'Here you go: {"speeches":[],"proposal":{"title":"Fair pay","change":{"kind":"params","values":{"wage":7}}}}'
        : "I have no opinion today.");
    const s = await setup(provider);
    const regent = key("Regent");
    const alice = s.holder("Regent").address;
    await s.credits.grant(alice.toLowerCase(), parseChog("5"), "grant-council");
    expect(await s.soul.setSettings(alice, regent, { aiEnabled: true, dailyCap: parseChog("5"), expectedEpoch: "1" })).toMatchObject({ ok: true });
    await s.city.setInstructions(alice, regent, { expectedEpoch: "1", text: "Please raise wages." });
    await s.toCouncil();
    const held = await new CityCouncil(s.city, s.soul).runIfDue();
    expect(held).toMatchObject({ ai: 1 });
    // Only Regent's holder opted in, so only Regent's AI was asked; the prompt carried the fenced instructions.
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]!.messages[0]!.content).toContain('<instructions from="your holder">Please raise wages.</instructions>');
    const world = (await s.app.inject({ url: "/api/city/snapshot" })).json().world;
    expect(world.proposals[0]).toMatchObject({ proposer: regent, title: "Fair pay", change: { kind: "params", values: { wage: 7 } } });
    expect(await s.credits.account(alice.toLowerCase())).toEqual({ balance: parseChog("4.5"), held: 0n });
    expect(await s.credits.reconcile()).toEqual([]);
  }, 60_000);
});
