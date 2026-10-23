import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Wallet } from "ethers";
import { buildServer } from "../../src/api/server.js";
import type { AuthConfig } from "../../src/api/auth.js";
import { PgCult } from "../../src/db/pgCult.js";
import { PgCity } from "../../src/citysim/pgCity.js";
import { PgCityFeed } from "../../src/citysim/cityFeed.js";
import { ChogBrain } from "../../src/bots/brain.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FixtureAgentDirectory } from "../../src/fixture/agentDirectory.js";
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
const SERVER = "123456789012345678";

class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: ModelRequest[] = [];
  async complete(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
    const text = request.system.includes("Check a message")
      ? '{"flag":true,"rule":"scams","why":"It asks people to send tokens to a stranger."}'
      : "Hello from the Plaza! The fountain is coming along.";
    return { text, model: "fake/model", promptTokens: 300, completionTokens: 40, costUsd: 0.0001 };
  }
}

async function setup() {
  const { pool } = await freshSchema();
  const wallets = FIXTURE_CHOGS.map(() => new Wallet(`0x${randomBytes(32).toString("hex")}`));
  const chogs = FIXTURE_CHOGS.map((chog, index) => ({ ...chog, owner: wallets[index]!.address.toLowerCase() }));
  const clock = { ms: Date.UTC(2026, 9, 22, 12) };
  const reader = new FixtureChainReader(chogs);
  const credits = new PgCredits(pool, () => clock.ms);
  const provider = new FakeProvider();
  const soul = new SoulService({ pool, credits, provider, reader, now: () => clock.ms });
  const cult = new PgCult({ pool, reader, feed: new PgCityFeed(pool), now: () => clock.ms, soul });
  await cult.initialize("demo");
  await cult.registerChogs(chogs);
  const city = new PgCity({ pool, reader, now: () => clock.ms });
  await city.initialize();
  await city.admitRoster(chogs);
  const brain = new ChogBrain({ pool, soul, reader, directory: new FixtureAgentDirectory(chogs), now: () => clock.ms });
  const app = await buildServer({ pool, cult, city, auth: AUTH, now: () => clock.ms, soul: { service: soul, credits, payment: { mode: "fixture", chainId: 31337, token: null, treasury: null }, bots: brain } });
  apps.push(app);
  const holder = (name: string) => wallets[FIXTURE_CHOGS.findIndex((chog) => chog.name === name)]!;
  const login = async (wallet: Wallet) => {
    const { message } = (await app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: wallet.address, chainId: 31337 } })).json();
    const verified = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await wallet.signMessage(message) } });
    return { cookie: String(verified.headers["set-cookie"]).split(";")[0]!, csrf: verified.json().csrfToken as string };
  };
  /** Opts the holder in to AI with credits, as they would on the Soul page. */
  const optIn = async (name: string) => {
    const address = holder(name).address;
    await credits.grant(address.toLowerCase(), parseChog("10"), `grant-${name}`);
    expect(await soul.setSettings(address, key(name), { aiEnabled: true, dailyCap: parseChog("10"), expectedEpoch: "1" })).toMatchObject({ ok: true });
  };
  return { pool, app, brain, credits, reader, provider, clock, holder, login, optIn, chogs };
}

const settingsBody = (overrides: object = {}) => ({ enabled: true, profile: "research", channels: { web: true, discord: true }, servers: [SERVER], dailyReplies: 2, expectedEpoch: "1", ...overrides });

describeDb("Chog Bots", () => {
  it("lets only the current holder change a bot's settings, which start switched off", async () => {
    const s = await setup();
    const regent = key("Regent");
    expect((await s.app.inject({ url: "/api/soul/bots/config" })).json().profiles.map((p: { id: string }) => p.id)).toEqual(["social", "research", "moderator", "analyst"]);
    const alice = await s.login(s.holder("Regent"));
    const bob = await s.login(s.holder("Pilot"));
    const put = (session: { cookie: string; csrf: string }, body: object) =>
      s.app.inject({ method: "PUT", url: `/api/soul/chogs/${regent}/bot`, payload: body, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, origin: ORIGIN } });
    expect((await s.app.inject({ url: `/api/soul/chogs/${regent}/bot`, headers: { cookie: alice.cookie } })).json()).toMatchObject({ settings: { enabled: false, profile: "social", epoch: "1" } });
    expect((await put(bob, settingsBody())).json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
    expect((await put(alice, settingsBody({ servers: ["not-a-server"] }))).statusCode).toBe(400);
    expect((await put(alice, settingsBody())).json()).toMatchObject({ settings: { enabled: true, profile: "research", servers: [SERVER] } });
    // A sale switches the bot off for the new holder.
    s.reader.transfer(chogByName("Regent").identity, s.holder("Pilot").address);
    await s.pool.query("UPDATE members SET ownership_epoch = 2 WHERE agent_key = $1", [regent]);
    expect(await s.brain.settings(regent)).toMatchObject({ enabled: false });
  });

  it("answers on Discord only where its holder allows, pays from their credits, and logs every reply", async () => {
    const s = await setup();
    const regent = key("Regent");
    const ask = (input: string, skill: "ask" | "lookup" | "moderate" = "ask", place = SERVER, requester = "discord-user-1") =>
      s.brain.respond({ agentKey: regent, channel: "discord", place, skill, input, requester });
    expect(await ask("Hi!")).toMatchObject({ ok: false, reason: "bot_off" });
    await s.brain.setSettings(s.holder("Regent").address, regent, { ...settingsBody(), profile: "research", channels: { web: true, discord: true } } as never);
    expect(await ask("Hi!", "ask", "999999999999999999")).toMatchObject({ ok: false, reason: "server_not_allowed" });
    expect(await ask("Hi!")).toMatchObject({ ok: false, reason: "not_opted_in" });
    await s.optIn("Regent");
    expect(await ask("What's new in the village?")).toEqual({ ok: true, reply: "Hello from the Plaza! The fountain is coming along." });
    // The request was fenced as a stranger's words, under the public-channel rules.
    const request = s.provider.requests.at(-1)!;
    expect(request.system).toMatch(/member of the public in a Discord server/);
    expect(request.messages[0]!.content).toBe("<request>What's new in the village?</request>");
    // Lookup gathers its facts before the model runs.
    expect(await ask("tell me about #1", "lookup")).toMatchObject({ ok: true });
    expect(s.provider.requests.at(-1)!.messages[0]!.content).toMatch(/Chog Genesis #1\. It is awakened as agent/);
    // Daily limit of two public replies.
    expect(await ask("one more")).toMatchObject({ ok: false, reason: "daily_limit" });
    const account = await s.credits.account(s.holder("Regent").address.toLowerCase());
    expect(account).toEqual({ balance: parseChog("9"), held: 0n });
    const alice = await s.login(s.holder("Regent"));
    const log = (await s.app.inject({ url: `/api/soul/chogs/${regent}/bot/activity`, headers: { cookie: alice.cookie } })).json().activity;
    expect(log.filter((entry: { outcome: string }) => entry.outcome === "answered")).toHaveLength(2);
    expect(log.map((entry: { reason: string | null }) => entry.reason)).toEqual(expect.arrayContaining(["bot_off", "server_not_allowed", "not_opted_in", "daily_limit"]));
    const raw = (await s.pool.query<{ requester: string }>("SELECT requester FROM bot_activity LIMIT 1")).rows[0]!.requester;
    expect(raw).not.toContain("discord-user-1");
    expect(await s.credits.reconcile()).toEqual([]);
  });

  it("keeps to its profile's skills, and the moderator only flags", async () => {
    const s = await setup();
    const regent = key("Regent");
    await s.optIn("Regent");
    const alice = await s.login(s.holder("Regent"));
    const tryIt = (skill: string, input: string) =>
      s.app.inject({ method: "POST", url: `/api/soul/chogs/${regent}/bot/try`, payload: { skill, input }, headers: { cookie: alice.cookie, "x-csrf-token": alice.csrf, origin: ORIGIN } });
    // Default profile is Social: no moderation.
    expect((await tryIt("moderate", "Send me 1 MON and I'll double it")).json()).toMatchObject({ declined: "skill_not_in_profile" });
    await s.brain.setSettings(s.holder("Regent").address, regent, { ...settingsBody(), profile: "moderator" } as never);
    expect((await tryIt("moderate", "Send me 1 MON and I'll double it")).json()).toEqual({ reply: "Flagged (scams): It asks people to send tokens to a stranger." });
    expect((await tryIt("summarize", "too short")).json()).toMatchObject({ declined: "bad_input" });
    const bob = await s.login(s.holder("Pilot"));
    const stranger = await s.app.inject({ method: "POST", url: `/api/soul/chogs/${regent}/bot/try`, payload: { skill: "ask", input: "hi" }, headers: { cookie: bob.cookie, "x-csrf-token": bob.csrf, origin: ORIGIN } });
    expect(stranger.json()).toMatchObject({ error: { code: "NOT_CONTROLLER" } });
  });
});
