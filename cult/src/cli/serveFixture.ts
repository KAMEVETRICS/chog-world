// Local fixture server: real PostgreSQL, fixture Chogs, fixture ownership and a fake City feed.
// Never use this for a public deployment: it binds to loopback only and invents its own holders.
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getAddress } from "ethers";
import { buildServer } from "../api/server.js";
import { migrate } from "../db/migrate.js";
import { PgCult } from "../db/pgCult.js";
import { FixtureChainReader } from "../fixture/chainReader.js";
import { HttpCityFeed } from "../city/httpFeed.js";
import { PgCityFeed } from "../citysim/cityFeed.js";
import { PgCity } from "../citysim/pgCity.js";
import { CityCouncil } from "../citysim/council.js";
import { ChogBrain } from "../bots/brain.js";
import { FixtureAgentDirectory } from "../fixture/agentDirectory.js";
import { FixtureHoldingsIndex } from "../chain/holdings.js";
import { DEFAULT_SOUL, parseChog } from "../soul/config.js";
import { PgCredits } from "../soul/credits.js";
import { OpenRouterProvider } from "../soul/provider.js";
import { SoulService } from "../soul/service.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName } from "../fixture/chogs.js";
import type { FactionId } from "../rules.js";

const url = process.env.CULT_DATABASE_URL;
if (!url) throw new Error("Set CULT_DATABASE_URL, for example the local test database from docker-compose.test.yml.");
const port = Number(process.env.PORT ?? 8787);
const pool = new pg.Pool({ connectionString: url, max: 10 });
await migrate(pool);
// CULT_DEV_HOLDER lets you try the owner panel: the unaligned fixture Chogs Drifter and Pilot are
// assigned to your own wallet address. Signing in only signs a message; nothing is sent on chain.
const devHolder = process.env.CULT_DEV_HOLDER ? getAddress(process.env.CULT_DEV_HOLDER).toLowerCase() : null;
const chogs = FIXTURE_CHOGS.map((chog) => (devHolder && (chog.name === "Drifter" || chog.name === "Pilot") ? { ...chog, owner: devHolder } : chog));
const reader = new FixtureChainReader(chogs);
// City runs in this server. CITY_API_URL instead follows a separately hosted City's event stream
// (see the Cult-City contract), and this server's own City is not started.
const cityUrl = process.env.CITY_API_URL;
const remoteCity = cityUrl ? new HttpCityFeed({ baseUrl: cityUrl, onError: (error) => console.error("City feed:", error instanceof Error ? error.message : error) }) : null;
// Chog Soul. AI is on only with OPENROUTER_API_KEY; fixture credits are granted, never bought.
const origin = process.env.CULT_ORIGIN ?? `http://127.0.0.1:${port}`;
const credits = new PgCredits(pool);
const apiKey = process.env.OPENROUTER_API_KEY?.trim();
const soulConfig = { ...DEFAULT_SOUL, model: process.env.SOUL_MODEL?.trim() || DEFAULT_SOUL.model };
const provider = apiKey ? new OpenRouterProvider({ apiKey, model: soulConfig.model, appUrl: origin }) : null;
const soul = new SoulService({ pool, credits, provider, reader, config: soulConfig });
if (devHolder) await credits.grant(devHolder, parseChog(process.env.SOUL_DEV_CREDITS ?? "50"), "fixture-dev-grant");
const cult = new PgCult({ pool, reader, feed: remoteCity ?? new PgCityFeed(pool), soul });
await cult.initialize("demo");
await cult.registerChogs(chogs);
remoteCity?.start((await cult.runtime()).cityCursor);
const city = remoteCity ? null : new PgCity({ pool, reader });
if (city) {
  await city.initialize();
  // Your own fixture Chogs (CULT_DEV_HOLDER) start outside City, so you can try bringing them in.
  const { admitted } = await city.admitRoster(devHolder ? chogs.filter((chog) => chog.owner !== devHolder) : chogs);
  // A lively first village: a few Chogs campaign socially or gather instead of building.
  const focus: Record<string, "social" | "gatherer"> = { Regent: "social", Ember: "social", Jester: "social", Banker: "gatherer" };
  for (const chog of chogs) {
    const chosen = focus[chog.name];
    if (!chosen || !admitted.includes(chog.agentKey)) continue;
    await city.setPolicy(chog.owner, chog.agentKey, { active: true, focus: chosen, homeStyle: "cottage" }, { expectedVersion: "1", expectedEpoch: "1" });
  }
}

// Seed factions once so the fixture village has something to fight over.
const seed: [keyof typeof FIXTURE_HOLDERS, string, FactionId][] = [
  ["alice", "Regent", "crown"], ["bob", "Banker", "crown"], ["carol", "Butler", "crown"],
  ["dave", "Ember", "chaos"], ["erin", "Glitch", "chaos"], ["frank", "Jester", "chaos"],
];
for (const [holder, name, faction] of seed) {
  const member = await cult.member(chogByName(name).agentKey);
  if (member?.faction === null && member.history.length === 0) await cult.setMembership(FIXTURE_HOLDERS[holder], chogByName(name).agentKey, { faction });
}

// Fixture login accepts the local chain ID only.
const auth = {
  domain: new URL(origin).host, origin, uri: origin, chainIds: [31337], secureCookies: false,
  challengeTtlMs: 5 * 60_000, sessionTtlMs: 12 * 60 * 60_000,
};
const webRoot = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const cityWebRoot = fileURLToPath(new URL("../../../city/dist/", import.meta.url));
const app = await buildServer({
  pool, logger: true, cult, ...(city ? { city, cityDirectory: new FixtureAgentDirectory(chogs), holdings: new FixtureHoldingsIndex(chogs, reader), cityWebRoot } : {}), auth, webRoot, site: { mode: "fixture", label: "Fixture Village", chainIds: auth.chainIds },
  soul: {
    service: soul, credits, payment: { mode: "fixture", chainId: 31337, token: null, treasury: null },
    bots: new ChogBrain({ pool, soul, reader, directory: new FixtureAgentDirectory(chogs) }),
  },
});
app.log.info({ ai: Boolean(provider), model: soulConfig.model }, provider ? "Chog Soul AI is on" : "Chog Soul AI is off: set OPENROUTER_API_KEY to switch it on");
// Holds left open by a crash are returned after ten minutes.
const sweeper = setInterval(() => { credits.refundStale(10 * 60_000).catch((error) => app.log.error({ err: error }, "credit sweep failed")); }, 60_000);
const council = city ? new CityCouncil(city, soul) : null;
const scheduler = setInterval(() => {
  cult.runDue().catch((error) => app.log.error({ err: error }, "scheduler step failed"));
  city?.runDue()
    .then(() => council?.runIfDue())
    .then((held) => { if (held) app.log.info(held, "city council held"); })
    .catch((error) => app.log.error({ err: error }, "city tick failed"));
}, 1000);
app.addHook("onClose", async () => { clearInterval(scheduler); clearInterval(sweeper); await remoteCity?.stop(); await pool.end(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
await app.listen({ host: "127.0.0.1", port });
