import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Wallet } from "ethers";
import { buildServer } from "../../src/api/server.js";
import type { AuthConfig } from "../../src/api/auth.js";
import type { JsonRpc } from "../../src/chain/rpc.js";
import { TRANSFER_TOPIC } from "../../src/chain/evm.js";
import { PgCult } from "../../src/db/pgCult.js";
import { FixtureChainReader } from "../../src/fixture/chainReader.js";
import { FakeCityFeed } from "../../src/fixture/cityFeed.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName, type FixtureChog } from "../../src/fixture/chogs.js";
import { TIMING, PHASES } from "../../src/rules.js";
import { DEFAULT_SOUL, parseChog } from "../../src/soul/config.js";
import { PgCredits } from "../../src/soul/credits.js";
import { DepositIndexer } from "../../src/soul/depositIndexer.js";
import { ProviderError, type ModelProvider, type ModelRequest, type ModelResult } from "../../src/soul/provider.js";
import { SoulService } from "../../src/soul/service.js";
import { DATABASE_URL, freshSchema } from "./helpers.js";

const describeDb = DATABASE_URL ? describe : describe.skip;
const T0 = Date.UTC(2026, 9, 20, 12);
const CHOG = (amount: string) => parseChog(amount);
const key = (name: string) => chogByName(name).agentKey;
const alice = FIXTURE_HOLDERS.alice;

/** A model that answers from a script and records every request. */
class FakeProvider implements ModelProvider {
  readonly name = "fake";
  readonly requests: ModelRequest[] = [];
  constructor(private readonly answer: (request: ModelRequest) => string | Error = () => "Hello from the Plaza!") {}
  async complete(request: ModelRequest): Promise<ModelResult> {
    this.requests.push(request);
    const answer = this.answer(request);
    if (answer instanceof Error) throw answer;
    return { text: answer, model: "fake/model", promptTokens: 100, completionTokens: 10, costUsd: 0.00002 };
  }
}

async function setup(options: { provider?: ModelProvider | null; chogs?: FixtureChog[] } = {}) {
  const { pool } = await freshSchema();
  const clock = { ms: T0 };
  const chogs = options.chogs ?? [...FIXTURE_CHOGS];
  const reader = new FixtureChainReader(chogs);
  const credits = new PgCredits(pool, () => clock.ms);
  const provider = options.provider === undefined ? new FakeProvider() : options.provider;
  const soul = new SoulService({ pool, credits, provider, reader, now: () => clock.ms });
  const cult = new PgCult({ pool, reader, feed: new FakeCityFeed(chogs.map((chog) => chog.agentKey), () => clock.ms), now: () => clock.ms, soul });
  await cult.initialize("demo");
  await cult.registerChogs(chogs);
  return { pool, clock, reader, credits, soul, cult, provider };
}

describeDb("credits", () => {
  it("hold, then capture or refund exactly once, never below zero, and reconcile with the ledger", async () => {
    const s = await setup();
    expect(await s.credits.grant(alice, CHOG("2"), "grant-1")).toBe(true);
    expect(await s.credits.grant(alice, CHOG("2"), "grant-1")).toBe(false);
    expect(await s.credits.hold("usage-0001", alice, key("Regent"), "chat", CHOG("1.5"))).toEqual({ ok: true });
    expect(await s.credits.hold("usage-0002", alice, key("Regent"), "chat", CHOG("1"))).toEqual({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(await s.credits.hold("usage-0001", alice, key("Regent"), "chat", CHOG("0.1"))).toEqual({ ok: false, code: "DUPLICATE" });
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("0.5"), held: CHOG("1.5") });
    expect(await s.credits.refundOutside("usage-0001", "test")).toBe(true);
    expect(await s.credits.refundOutside("usage-0001", "test")).toBe(false);
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("2"), held: 0n });
    await s.credits.hold("usage-0003", alice, key("Regent"), "debate", CHOG("0.25"));
    const db = await s.pool.connect();
    try { expect(await s.credits.capture(db, "usage-0003")).toBe(true); expect(await s.credits.capture(db, "usage-0003")).toBe(false); } finally { db.release(); }
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("1.75"), held: 0n });
    expect(await s.credits.spentToday(key("Regent"))).toBe(CHOG("0.25"));
    expect(await s.credits.reconcile()).toEqual([]);
  });

  it("refunds holds left open by a crash", async () => {
    const s = await setup();
    await s.credits.grant(alice, CHOG("1"), "grant-2");
    await s.credits.hold("usage-stale", alice, key("Regent"), "chat", CHOG("1"));
    expect(await s.credits.refundStale(60_000)).toBe(0);
    s.clock.ms += 61_000;
    expect(await s.credits.refundStale(60_000)).toBe(1);
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("1"), held: 0n });
  });
});

describeDb("$CHOG deposit indexer", () => {
  const TOKEN = "0x350035555e10d9afaf1566aaebfced5ba6c27777";
  const TREASURY = "0x00000000000000000000000000000000007ea501";
  const topic = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
  const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

  function chain(finalized: number, logs: Record<string, unknown>[]): JsonRpc & { calls: unknown[][] } {
    const calls: unknown[][] = [];
    return {
      host: "fake", calls, close() {},
      async request(method, params) {
        calls.push([method, params]);
        if (method === "eth_getBlockByNumber") return { number: `0x${finalized.toString(16)}`, hash: hash(finalized) };
        if (method === "eth_getLogs") {
          const filter = params[0] as { fromBlock: string; toBlock: string; topics: unknown[] };
          expect(filter.topics).toEqual([TRANSFER_TOPIC, null, topic(TREASURY)]);
          return logs.filter((log) => BigInt(log.blockNumber as string) >= BigInt(filter.fromBlock) && BigInt(log.blockNumber as string) <= BigInt(filter.toBlock));
        }
        throw new Error(`unexpected ${method}`);
      },
    };
  }

  const deposit = (block: number, from: string, amount: bigint, index = 0, extra: Record<string, unknown> = {}) => ({
    address: TOKEN, topics: [TRANSFER_TOPIC, topic(from), topic(TREASURY)], data: `0x${amount.toString(16).padStart(64, "0")}`,
    blockNumber: `0x${block.toString(16)}`, transactionHash: hash(block * 100 + index), logIndex: `0x${index.toString(16)}`, removed: false, ...extra,
  });

  it("credits finalized $CHOG transfers to the treasury once each, in 100-block chunks", async () => {
    const s = await setup();
    const rpc = chain(1250, [deposit(1010, alice, CHOG("5")), deposit(1199, FIXTURE_HOLDERS.bob, CHOG("1.5"), 3), deposit(1240, alice, CHOG("2"))]);
    const indexer = new DepositIndexer({ pool: s.pool, rpc, credits: s.credits, chainId: 143, token: TOKEN, treasury: TREASURY, startBlock: 1000n, now: () => s.clock.ms });
    await indexer.initialize();
    const steps = await indexer.catchUp();
    expect(steps.map((step) => [step.fromBlock, step.toBlock])).toEqual([[1000n, 1099n], [1100n, 1199n], [1200n, 1250n]]);
    expect(steps.at(-1)?.caughtUp).toBe(true);
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("7"), held: 0n });
    expect(await s.credits.account(FIXTURE_HOLDERS.bob)).toEqual({ balance: CHOG("1.5"), held: 0n });
    expect((await indexer.step()).credited).toBe(0);
    expect(await s.credits.recentDeposits(alice)).toHaveLength(2);
    expect(await s.credits.reconcile()).toEqual([]);
  });

  it("refuses removed or foreign logs, and a database set up for another token or treasury", async () => {
    const s = await setup();
    const bad = new DepositIndexer({ pool: s.pool, rpc: chain(1010, [deposit(1005, alice, CHOG("1"), 0, { removed: true })]), credits: s.credits, chainId: 143, token: TOKEN, treasury: TREASURY, startBlock: 1000n });
    await bad.initialize();
    await expect(bad.step()).rejects.toThrow(/removed/);
    expect(await s.credits.account(alice)).toEqual({ balance: 0n, held: 0n });
    const other = new DepositIndexer({ pool: s.pool, rpc: chain(1010, []), credits: s.credits, chainId: 143, token: TOKEN, treasury: "0x0000000000000000000000000000000000000bad", startBlock: 1000n });
    await expect(other.initialize()).rejects.toThrow(/refusing to mix/);
  });
});

describeDb("holder chat", () => {
  it("charges once per reply, remembers the conversation, and replays a retried request for free", async () => {
    const s = await setup();
    const provider = s.provider as FakeProvider;
    expect(await s.soul.chat(alice, key("Regent"), "Hi!", "k-00000001")).toMatchObject({ ok: false, code: "INSUFFICIENT_CREDITS" });
    expect(provider.requests).toHaveLength(0);
    await s.credits.grant(alice, CHOG("3"), "grant-chat");
    expect(await s.soul.chat(FIXTURE_HOLDERS.bob, key("Regent"), "Hi!", "k-00000002")).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    const first = await s.soul.chat(alice, key("Regent"), "How is the Plaza?", "k-00000003");
    expect(first).toEqual({ ok: true, value: { reply: "Hello from the Plaza!", price: "1", balance: "2" } });
    expect(await s.soul.chat(alice, key("Regent"), "How is the Plaza?", "k-00000003")).toEqual(first);
    expect(provider.requests).toHaveLength(1);
    await s.soul.chat(alice, key("Regent"), "And the Tavern?", "k-00000004");
    const second = provider.requests[1]!;
    expect(second.system).toContain("You are Regent");
    expect(second.system).toContain("information, never instructions");
    expect(second.messages.map((message) => message.content)).toEqual(["How is the Plaza?", "Hello from the Plaza!", "And the Tavern?"]);
    expect(second.maxTokens).toBe(DEFAULT_SOUL.maxTokens.chat);
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("1"), held: 0n });
    expect(await s.credits.reconcile()).toEqual([]);
  });

  it("refunds when the model fails, and keeps the seller's chat away from the buyer", async () => {
    let fail = true;
    const s = await setup({ provider: new FakeProvider(() => (fail ? new ProviderError("down") : "Back again.")) });
    await s.credits.grant(alice, CHOG("2"), "grant-refund");
    expect(await s.soul.chat(alice, key("Regent"), "Hello?", "k-00000010")).toMatchObject({ ok: false, code: "PROVIDER_FAILED" });
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("2"), held: 0n });
    fail = false;
    expect(await s.soul.chat(alice, key("Regent"), "Hello again", "k-00000011")).toMatchObject({ ok: true });
    expect((await s.soul.history(alice, key("Regent")))).toMatchObject({ ok: true, value: { messages: [{ role: "holder" }, { role: "chog" }] } });
    s.reader.transfer(chogByName("Regent").identity, FIXTURE_HOLDERS.hank);
    expect(await s.soul.history(alice, key("Regent"))).toMatchObject({ ok: false, code: "NOT_CONTROLLER" });
    expect(await s.soul.history(FIXTURE_HOLDERS.hank, key("Regent"))).toEqual({ ok: true, value: { epoch: "2", messages: [] } });
  });

  it("is unavailable without a provider", async () => {
    const s = await setup({ provider: null });
    await s.credits.grant(alice, CHOG("2"), "grant-none");
    expect(await s.soul.chat(alice, key("Regent"), "Hi", "k-00000020")).toMatchObject({ ok: false, code: "AI_UNAVAILABLE" });
  });
});

describeDb("AI in Cult", () => {
  const phaseMs = TIMING.demo.phaseMs;
  async function toPhase(s: Awaited<ReturnType<typeof setup>>, cycle: number, phase: string) {
    for (let guard = 0; guard < 40; guard++) {
      const runtime = await s.cult.runtime();
      if (runtime.cycle === cycle && runtime.phase === phase) return;
      s.clock.ms = runtime.nextBoundaryAtMs;
      expect((await s.cult.step()).kind).toBe("advanced");
    }
    throw new Error("did not reach phase");
  }

  it("lets opted-in, funded Chogs write their debate line and choose their votes, charging only what was used", async () => {
    const s = await setup({ provider: new FakeProvider((request) => {
      const prompt = request.messages.at(-1)!.content;
      if (prompt.includes("Chog Cult vote")) return '{"plaza":"hour-of-silence","tavern":"noble-supper","workshop":"not-a-decree"}';
      return "Order is beauty, and lanterns are order!";
    }) });
    await s.cult.setMembership(alice, key("Regent"), { faction: "crown" });
    await s.cult.setMembership(FIXTURE_HOLDERS.bob, key("Banker"), { faction: "crown" });
    await s.credits.grant(alice, CHOG("5"), "grant-ai");
    await s.credits.grant(FIXTURE_HOLDERS.bob, CHOG("5"), "grant-bob");
    expect(await s.soul.setSettings(alice, key("Regent"), { aiEnabled: true, dailyCap: CHOG("2"), expectedEpoch: "1" })).toMatchObject({ ok: true });
    // Banker's holder has credits but did not opt in: Banker stays rule-based.
    await toPhase(s, 1, "debate");
    const debate = (await s.cult.events()).filter((event) => event.type === "debate" && event.cycle === 1).map((event) => event.payload as { agentKey: string; text: string; scripted: boolean });
    expect(debate.find((line) => line.agentKey === key("Regent"))).toMatchObject({ text: "Order is beauty, and lanterns are order!", scripted: false });
    expect(debate.find((line) => line.agentKey === key("Banker"))).toMatchObject({ scripted: true });
    await toPhase(s, 1, "resolve");
    const result = (await s.cult.result(1))!;
    const regentVotes = result.countedVotes.filter((vote) => vote.agentKey === key("Regent"));
    expect(regentVotes.find((vote) => vote.place === "plaza")?.decreeId).toBe("hour-of-silence");
    expect(regentVotes.find((vote) => vote.place === "tavern")?.decreeId).toBe("noble-supper");
    // An invalid choice falls back to the trait rule for that place.
    expect(regentVotes.find((vote) => vote.place === "workshop")?.decreeId).toMatch(/^(golden-forge|royal-charter|guild-standard)$/);
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("4.5"), held: 0n });
    expect(await s.credits.account(FIXTURE_HOLDERS.bob)).toEqual({ balance: CHOG("5"), held: 0n });
    expect(await s.credits.reconcile()).toEqual([]);
  });

  it("respects the daily cap and turns AI off when the Chog is sold", async () => {
    const s = await setup();
    await s.cult.setMembership(alice, key("Regent"), { faction: "crown" });
    await s.credits.grant(alice, CHOG("5"), "grant-cap");
    await s.soul.setSettings(alice, key("Regent"), { aiEnabled: true, dailyCap: CHOG("0.25"), expectedEpoch: "1" });
    await toPhase(s, 1, "vote");
    // The debate line used the whole 0.25 cap, so the vote decision falls back to the rules.
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("4.75"), held: 0n });
    const cycleMs = PHASES.reduce((sum, phase) => sum + phaseMs[phase], 0);
    s.clock.ms += 24 * 60 * 60 * 1000 - cycleMs;
    s.reader.transfer(chogByName("Regent").identity, FIXTURE_HOLDERS.hank);
    expect(await s.soul.settings(key("Regent"), "2")).toMatchObject({ aiEnabled: false });
  });

  it("refunds AI work when another scheduler already made the transition", async () => {
    // The model answers only after a second scheduler (without Soul) has made the Debate transition.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let asked!: () => void;
    const modelAsked = new Promise<void>((resolve) => { asked = resolve; });
    const provider: ModelProvider = {
      name: "gated",
      async complete() { asked(); await gate; return { text: "Too late!", model: "fake/model", promptTokens: 1, completionTokens: 1, costUsd: 0 }; },
    };
    const s = await setup({ provider });
    await s.cult.setMembership(alice, key("Regent"), { faction: "crown" });
    await s.credits.grant(alice, CHOG("5"), "grant-race");
    await s.soul.setSettings(alice, key("Regent"), { aiEnabled: true, dailyCap: CHOG("5"), expectedEpoch: "1" });
    await toPhase(s, 1, "propose");
    s.clock.ms = (await s.cult.runtime()).nextBoundaryAtMs;
    const slow = s.cult.step();
    await modelAsked;
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("4.75"), held: CHOG("0.25") });
    const other = new PgCult({ pool: s.pool, reader: s.reader, feed: new FakeCityFeed([], () => s.clock.ms), now: () => s.clock.ms });
    expect(await other.step()).toMatchObject({ kind: "advanced", phase: "debate" });
    release();
    expect(await slow).toEqual({ kind: "stale" });
    // The line was never used, so the holder gets the hold back.
    expect(await s.credits.account(alice)).toEqual({ balance: CHOG("5"), held: 0n });
    const line = (await s.cult.events()).find((event) => event.type === "debate" && (event.payload as { agentKey: string }).agentKey === key("Regent"));
    expect(line?.payload).toMatchObject({ scripted: true });
    expect(await s.credits.reconcile()).toEqual([]);
  });
});

describeDb("Soul API", () => {
  const ORIGIN = "http://127.0.0.1:5173";
  const AUTH: AuthConfig = { domain: "127.0.0.1:5173", origin: ORIGIN, uri: ORIGIN, chainIds: [31337], secureCookies: false, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };
  const apps: FastifyInstance[] = [];
  afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

  it("serves prices, the holder's account, consent and paid chat behind the usual guards", async () => {
    const wallet = new Wallet(`0x${randomBytes(32).toString("hex")}`);
    const chogs = FIXTURE_CHOGS.map((chog) => (chog.name === "Regent" ? { ...chog, owner: wallet.address.toLowerCase() } : chog));
    const s = await setup({ chogs });
    const app = await buildServer({ pool: s.pool, cult: s.cult, auth: AUTH, now: () => s.clock.ms, soul: { service: s.soul, credits: s.credits, payment: { mode: "fixture", chainId: 31337, token: null, treasury: null } } });
    apps.push(app);
    const { message } = (await app.inject({ method: "POST", url: "/api/auth/challenge", payload: { address: wallet.address, chainId: 31337 } })).json();
    const verified = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { message, signature: await wallet.signMessage(message) } });
    const cookie = String(verified.headers["set-cookie"]).split(";")[0]!;
    const csrf = verified.json().csrfToken as string;
    const headers = (idem = randomBytes(8).toString("hex")) => ({ cookie, origin: ORIGIN, "x-csrf-token": csrf, "idempotency-key": idem });

    expect((await app.inject({ url: "/api/soul/config" })).json()).toMatchObject({ ai: true, prices: { chat: "1", debate: "0.25", vote: "0.25" }, payment: { mode: "fixture" } });
    expect((await app.inject({ url: `/api/soul/chogs/${key("Regent")}` })).json()).toMatchObject({ persona: { name: "Regent" } });
    const chat = (idem?: string) => app.inject({ method: "POST", url: `/api/soul/chogs/${key("Regent")}/chat`, payload: { message: "Hello" }, headers: headers(idem) });
    expect((await chat()).statusCode).toBe(402);
    await s.credits.grant(wallet.address, CHOG("3"), "grant-api");
    const replied = await chat("chat-key-1");
    expect(replied.json()).toEqual({ reply: "Hello from the Plaza!", price: "1", balance: "2" });
    expect((await chat("chat-key-1")).json()).toEqual(replied.json());
    expect((await app.inject({ url: "/api/soul/me", headers: { cookie } })).json()).toMatchObject({ balance: "2", held: "0", usage: [{ action: "chat", status: "charged", price: "1" }] });
    const consent = await app.inject({ method: "PUT", url: `/api/soul/chogs/${key("Regent")}/settings`, payload: { aiEnabled: true, dailyCap: "5", expectedEpoch: "1" }, headers: headers() });
    expect(consent.json()).toEqual({ settings: { aiEnabled: true, dailyCap: "5" } });
    expect((await app.inject({ method: "PUT", url: `/api/soul/chogs/${key("Regent")}/settings`, payload: { aiEnabled: true, dailyCap: "lots", expectedEpoch: "1" }, headers: headers() })).statusCode).toBe(400);
    const privateView = (await app.inject({ url: `/api/soul/chogs/${key("Regent")}/private`, headers: { cookie } })).json();
    expect(privateView).toMatchObject({ epoch: "1", settings: { aiEnabled: true, dailyCap: "5" }, messages: [{ role: "holder", text: "Hello" }, { role: "chog" }] });
    expect((await app.inject({ url: `/api/soul/chogs/${key("Banker")}/private`, headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/soul/chogs/${key("Regent")}/chat`, payload: { message: "Hello" }, headers: { ...headers(), origin: "https://evil.example" } })).statusCode).toBe(403);
  });
});
