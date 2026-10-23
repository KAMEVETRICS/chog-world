// End-to-end acceptance run for the Chog Cult design's section 7, with two independent viewers.
// Real HTTP server, PostgreSQL scheduler, SIWE logins and the live City reader against a stand-in City.
// Local only: fixture Chogs, throwaway wallets, a manual clock and its own database schema.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { Wallet } from "ethers";
import { buildServer } from "../api/server.js";
import type { AuthConfig } from "../api/auth.js";
import { HttpCityFeed } from "../city/httpFeed.js";
import { migrate } from "../db/migrate.js";
import { PgCult } from "../db/pgCult.js";
import { FixtureChainReader } from "../fixture/chainReader.js";
import { FIXTURE_CHOGS, chogByName } from "../fixture/chogs.js";
import { FakeCityServer } from "../fixture/fakeCityServer.js";
import type { Place } from "../rules.js";

export interface Check { readonly name: string; readonly ok: boolean; readonly detail: string }

interface Frame { revision: string; type: string }

/** A browser-like viewer: follows the public SSE stream and can read the snapshot. */
class Viewer {
  readonly frames: Frame[] = [];
  readonly #abort = new AbortController();
  #done: Promise<void> | undefined;
  constructor(readonly name: string, readonly baseUrl: string) {}

  open(): void {
    this.#done = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/cult/events?after=0`, { signal: this.#abort.signal });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const id = /^id: (\d+)$/m.exec(block)?.[1];
            const type = /^event: (\S+)$/m.exec(block)?.[1];
            if (id && type) this.frames.push({ revision: id, type });
          }
        }
      } catch (error) {
        if ((error as Error).name !== "AbortError") throw error;
      }
    })();
  }

  async close(): Promise<void> { this.#abort.abort(); await this.#done; }
  snapshot(): Promise<{ revision: string; cycle: number; phase: string; places: unknown; members: { name: string; faction: string | null; currentVotes: { place: Place; decreeId: string | null; source: string }[]; history: unknown[] }[] }> {
    return fetch(`${this.baseUrl}/api/cult/snapshot`).then((response) => response.json());
  }
}

async function until(check: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the demo to settle");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export async function runAcceptance(databaseUrl: string, say: (line: string) => void = () => {}): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail: string) => { checks.push({ name, ok, detail }); say(`${ok ? "✓" : "✗"} ${name}: ${detail}`); };

  const schema = `cult_demo_${randomBytes(5).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 8, options: `-c search_path=${schema}` });
  const city = new FakeCityServer({ heartbeatMs: 200 });
  const clock = { ms: Date.UTC(2026, 9, 21, 12) };
  const holders = Object.fromEntries(["alice", "bob", "dave", "gina", "hank"].map((name) => [name, new Wallet(`0x${randomBytes(32).toString("hex")}`)]));
  const ownerOf: Record<string, keyof typeof holders> = { Regent: "alice", Banker: "bob", Ember: "dave", Drifter: "gina", Pilot: "hank" };
  const chogs = FIXTURE_CHOGS.map((chog) => (ownerOf[chog.name] ? { ...chog, owner: holders[ownerOf[chog.name]!]!.address.toLowerCase() } : chog));
  const reader = new FixtureChainReader(chogs);
  let liveFeed: HttpCityFeed | undefined;
  let app: Awaited<ReturnType<typeof buildServer>> | undefined;
  const viewers: Viewer[] = [];
  try {
    await migrate(pool);
    await city.start();
    const feed = new HttpCityFeed({ baseUrl: city.url, reconnectMs: 50, staleMs: 3000 });
    liveFeed = feed;
    const cult = new PgCult({ pool, reader, feed, now: () => clock.ms });
    await cult.initialize("demo");
    await cult.registerChogs(chogs);
    feed.start((await cult.runtime()).cityCursor);
    const origin = "http://127.0.0.1";
    const auth: AuthConfig = { domain: "127.0.0.1", origin, uri: origin, chainIds: [31337], secureCookies: false, challengeTtlMs: 300_000, sessionTtlMs: 43_200_000 };
    app = await buildServer({ pool, cult, auth, now: () => clock.ms, sse: { pollMs: 25, heartbeatMs: 1000 } });
    const base = await app.listen({ host: "127.0.0.1", port: 0 });
    say(`Cult API at ${base}; stand-in City at ${city.url}; schema ${schema}.`);
    for (const name of ["viewer A", "viewer B"]) { const viewer = new Viewer(name, base); viewer.open(); viewers.push(viewer); }

    const sessions: Record<string, { cookie: string; csrf: string }> = {};
    const login = async (who: keyof typeof holders) => {
      const wallet = holders[who]!;
      const { message } = await (await fetch(`${base}/api/auth/challenge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address, chainId: 31337 }) })).json();
      const response = await fetch(`${base}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature: await wallet.signMessage(message) }) });
      sessions[who] = { cookie: String(response.headers.get("set-cookie")).split(";")[0]!, csrf: (await response.json()).csrfToken };
    };
    const put = async (who: string, path: string, body: object) => {
      const session = sessions[who]!;
      const response = await fetch(`${base}${path}`, { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie: session.cookie, origin, "x-csrf-token": session.csrf, "idempotency-key": randomBytes(8).toString("hex") } });
      return { status: response.status, body: await response.json() };
    };
    const me = async (who: string) => (await fetch(`${base}/api/me`, { headers: { cookie: sessions[who]!.cookie } })).json();
    const key = (name: string) => chogByName(name).agentKey;
    // City activity during a phase: Regent and Ember are regulars at the Plaza.
    const cityTicks = (count: number) => {
      for (let index = 0; index < count; index++) {
        city.publishTick([
          { agentKey: key("Regent"), kind: "visit", location: { kind: "place", placeId: "plaza" } },
          { agentKey: key("Ember"), kind: "greet", location: { kind: "place", placeId: "plaza" } },
          { agentKey: key("Banker"), kind: "gather", location: { kind: "place", placeId: "quarry" } },
        ], clock.ms + index * 10_000);
      }
    };
    const step = async () => {
      const runtime = await cult.runtime();
      clock.ms = runtime.nextBoundaryAtMs;
      if (runtime.phase === "vote") {
        // Let the live reader receive what City published before the cycle resolves.
        const latest = city.revision;
        await until(async () => { const read = await feed.eventsSince(runtime.cityCursor); return !read.available || read.events.at(-1)?.revision === latest || latest === runtime.cityCursor; });
      }
      const outcome = await cult.step();
      if (outcome.kind !== "advanced") throw new Error(`expected a transition, got ${outcome.kind}`);
      return outcome;
    };
    const toPhase = async (cycle: number, phase: string) => {
      for (let guard = 0; guard < 40; guard++) {
        const runtime = await cult.runtime();
        if (runtime.cycle === cycle && runtime.phase === phase) return;
        const next = await step();
        if (next.phase === "debate" || next.phase === "vote") cityTicks(3);
      }
      throw new Error(`could not reach cycle ${cycle} ${phase}`);
    };

    // Cycle 0: holders choose sides.
    for (const who of ["alice", "bob", "dave", "gina", "hank"] as const) await login(who);
    await put("alice", `/api/cult/members/${key("Regent")}`, { faction: "crown", expectedEpoch: "1" });
    await put("bob", `/api/cult/members/${key("Banker")}`, { faction: "crown", expectedEpoch: "1" });
    await put("dave", `/api/cult/members/${key("Ember")}`, { faction: "chaos", expectedEpoch: "1" });
    say("Cycle 0: alice puts Regent and bob puts Banker in the Crown; dave puts Ember in the Chaos.");

    // Cycle 1 vote: agents vote; alice overrides the Plaza; gina flash-joins.
    await toPhase(1, "vote");
    const viewerA = viewers[0]!;
    const before = (await viewerA.snapshot()).members.find((member) => member.name === "Regent")!;
    const agentVoted = before.currentVotes.length === 3 && before.currentVotes.every((vote) => vote.source === "agent");
    const plazaBefore = before.currentVotes.find((vote) => vote.place === "plaza")!.decreeId;
    const override = plazaBefore === "golden-lanterns" ? "hour-of-silence" : "golden-lanterns";
    const overridden = await put("alice", `/api/cult/votes/1/${key("Regent")}/plaza`, { decreeId: override, expectedEpoch: "1" });
    const after = (await viewerA.snapshot()).members.find((member) => member.name === "Regent")!;
    await put("gina", `/api/cult/members/${key("Drifter")}`, { faction: "chaos", expectedEpoch: "1" });
    const flashVote = await put("gina", `/api/cult/votes/1/${key("Drifter")}/tavern`, { decreeId: "open-tab", expectedEpoch: "1" });
    await toPhase(2, "propose");
    const result1 = await cult.result(1);
    const regentPlaza = result1!.countedVotes.filter((vote) => vote.agentKey === key("Regent") && vote.place === "plaza");
    check("Agents vote on their own, and a holder override changes the tally",
      agentVoted && overridden.status === 200 && after.currentVotes.find((vote) => vote.place === "plaza")?.source === "holder"
        && regentPlaza.length === 1 && regentPlaza[0]!.source === "holder" && regentPlaza[0]!.decreeId === override,
      `Regent's agent voted all 3 places; alice switched the Plaza from ${plazaBefore} to ${override}, and cycle 1 counted ${override}.`);
    check("Flash-joining during Vote does not count",
      flashVote.status === 409 && flashVote.body.error.code === "NOT_ELIGIBLE" && !result1!.countedVotes.some((vote) => vote.agentKey === key("Drifter")),
      `Drifter joined mid-vote; its override was refused with ${flashVote.body.error.code} and it cast no votes in cycle 1.`);
    const switchBack = await put("gina", `/api/cult/members/${key("Drifter")}`, { faction: "crown", expectedEpoch: "1" });
    check("Switching faction again within 2 cycles is refused", switchBack.status === 409 && switchBack.body.error.code === "SWITCH_COOLDOWN", `gina got ${switchBack.body.error.code}: ${switchBack.body.error.message}`);

    // Cycle 2 vote: dave overrides, then sells Ember to hank mid-vote. Two schedulers race the resolve.
    await toPhase(2, "vote");
    const daveOverride = await put("dave", `/api/cult/votes/2/${key("Ember")}/tavern`, { decreeId: "open-tab", expectedEpoch: "1" });
    reader.transfer(chogByName("Ember").identity, holders.hank!.address);
    const sellerRefused = await put("dave", `/api/cult/votes/2/${key("Ember")}/plaza`, { decreeId: "bell-riot", expectedEpoch: "1" });
    const hankEmber = (await me("hank")).chogs.find((chog: { name: string }) => chog.name === "Ember");
    const reputationBefore = await cult.reputation();
    clock.ms = (await cult.runtime()).nextBoundaryAtMs;
    const racer = new PgCult({ pool, reader, feed, now: () => clock.ms });
    const raced = await Promise.all([cult.step(), racer.step()]);
    const result2 = await cult.result(2);
    const emberRejected = result2!.rejectedVotes.filter((entry) => entry.vote.agentKey === key("Ember"));
    const emberSnapshot = (await viewerA.snapshot()).members.find((member) => member.name === "Ember")!;
    check("A sale during Vote voids the seller's votes and override; the buyer starts Unaligned with history kept",
      daveOverride.status === 200 && sellerRefused.status === 403 && hankEmber?.faction === null && hankEmber?.ownershipEpoch === "2"
        && emberRejected.length >= 3 && !result2!.countedVotes.some((vote) => vote.agentKey === key("Ember")) && emberSnapshot.history.length === 1,
      `dave's later request got ${sellerRefused.body.error.code}; ${emberRejected.length} Ember votes were not counted; hank holds Ember at epoch 2, Unaligned, with its Chaos history.`);
    const reputationAfter = await cult.reputation();
    const regentGain = (reputationAfter[key("Regent")]?.glory ?? 0) - (reputationBefore[key("Regent")]?.glory ?? 0);
    const crownWon = Object.values(result2!.places).filter((place) => place.outcome === "won" && place.control?.faction === "crown").length;
    check("Two schedulers racing the same resolve apply it once",
      raced.filter((outcome) => outcome.kind === "advanced").length === 1 && regentGain === crownWon,
      `outcomes ${raced.map((outcome) => outcome.kind).join(" + ")}; Regent gained ${regentGain} glory for ${crownWon} Crown win(s), not double.`);
    const presence2 = Object.values(result2!.places).reduce((sum, place) => sum + place.influence.crown.presence + place.influence.chaos.presence, 0);

    // Cycle 3: City goes down before the vote resolves.
    await toPhase(3, "vote");
    await city.stop();
    await until(async () => !(await feed.eventsSince((await cult.runtime()).cityCursor)).available);
    await toPhase(4, "propose");
    const result3 = await cult.result(3);
    const presence3 = Object.values(result3!.places).reduce((sum, place) => sum + place.influence.crown.presence + place.influence.chaos.presence, 0);
    const gapEvent = (await cult.events()).find((event) => event.type === "city_gap" && event.cycle === 3);
    check("With City down, presence counts zero, the cycle still resolves, and the gap is public",
      presence2 > 0 && presence3 === 0 && Boolean(gapEvent) && result3!.countedVotes.length > 0,
      `cycle 2 presence ${presence2}, cycle 3 presence ${presence3}; city_gap: "${(gapEvent?.payload as { reason?: string } | undefined)?.reason}"; ${result3!.countedVotes.length} votes still decided cycle 3.`);

    // Both viewers must have seen the same history and agree with the server.
    const latest = (await cult.runtime()).revision;
    await until(() => viewers.every((viewer) => viewer.frames.at(-1)?.revision === latest));
    const [a, b] = viewers;
    const sameStream = JSON.stringify(a!.frames) === JSON.stringify(b!.frames);
    const consecutive = a!.frames.every((frame, index) => frame.revision === String(index + 1));
    const [snapA, snapB] = await Promise.all([a!.snapshot(), b!.snapshot()]);
    check("Two viewers see the same phases, votes and outcomes",
      sameStream && consecutive && JSON.stringify(snapA) === JSON.stringify(snapB) && snapA.revision === latest,
      `both received ${a!.frames.length} events (revisions 1–${latest}, no gaps or repeats) and identical snapshots at cycle ${snapA.cycle}.`);
    return checks;
  } finally {
    for (const viewer of viewers) await viewer.close().catch(() => {});
    await app?.close().catch(() => {});
    await liveFeed?.stop();
    await city.stop().catch(() => {});
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
}
