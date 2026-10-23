// Starts the public Cult server: verified manifest, live Monad ownership, real City feed, SIWE on chain
// 143 with Secure cookies at the configured origin. Nothing from fixture mode is imported here.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../api/server.js";
import type { AuthConfig } from "../api/auth.js";
import { HttpCityFeed } from "../city/httpFeed.js";
import { PgCityFeed } from "../citysim/cityFeed.js";
import { PgCity } from "../citysim/pgCity.js";
import { CityCouncil } from "../citysim/council.js";
import { LiveAgentDirectory } from "../chain/agentDirectory.js";
import { GENESIS_MAX_TOKEN_ID, genesisTraits } from "../citysim/world.js";
import { LiveHoldingsIndex } from "../chain/holdings.js";
import { CHOG_TOKEN_MAINNET, DEFAULT_SOUL } from "../soul/config.js";
import { PgCredits } from "../soul/credits.js";
import { DepositIndexer } from "../soul/depositIndexer.js";
import { OpenRouterProvider } from "../soul/provider.js";
import { SoulService } from "../soul/service.js";
import { ChogBrain } from "../bots/brain.js";
import { migrate } from "../db/migrate.js";
import { PgCult } from "../db/pgCult.js";
import { LiveChainReader, type LiveChainReaderOptions, type LiveDeployment } from "../chain/liveChainReader.js";
import { parseManifest, verifyManifest } from "../chain/manifest.js";
import { PgProjectionStore } from "../chain/pgProjectionStore.js";
import { HttpJsonRpc } from "../chain/rpc.js";
import type { AgentIdentity } from "../shared/identity.js";
import { LIVE_CHAIN_ID, type LiveConfig } from "./config.js";
import { parseRoster } from "./roster.js";

export interface LiveServer {
  readonly app: FastifyInstance;
  readonly reader: LiveChainReader;
  readonly cult: PgCult;
  /** Null when following a separately hosted City. */
  readonly city: PgCity | null;
  close(): Promise<void>;
}

export interface StartLiveOptions {
  readonly logger?: boolean;
  /** Directory of the built web UI; defaults to web/dist. */
  readonly webRoot?: string | null;
  /** Directory of Chog City's built UI, served at /city/; defaults to ../city/dist. */
  readonly cityWebRoot?: string | null;
  /** Projection tuning; the defaults suit Monad's public RPC. */
  readonly reader?: Pick<LiveChainReaderOptions, "chunkBlocks" | "parallelRequests" | "pollMs" | "maxAgeMs" | "budgetMs">;
  readonly schedulerMs?: number;
}

const sameDeployment = (identity: AgentIdentity, deployment: LiveDeployment) =>
  identity.chainId === deployment.chainId && identity.registry.toLowerCase() === deployment.registry
  && identity.adapter.toLowerCase() === deployment.adapter && identity.collection.toLowerCase() === deployment.collection;

/** A database used with fixture Chogs, or with another manifest, must not be reused for live mode. */
async function refuseForeignMembers(pool: pg.Pool, deployment: LiveDeployment): Promise<void> {
  const { rows } = await pool.query<{ agent_key: string; identity: AgentIdentity }>("SELECT agent_key, identity FROM members ORDER BY agent_key");
  const foreign = rows.filter((row) => !sameDeployment(row.identity, deployment));
  if (foreign.length) {
    throw new Error(`The database holds ${foreign.length} Chog(s) from another deployment, for example ${foreign[0]!.agent_key}. `
      + "Fixture data must never reach a live server: use a database dedicated to this manifest.");
  }
}

export async function startLive(config: LiveConfig, options: StartLiveOptions = {}): Promise<LiveServer> {
  const cleanup: (() => Promise<void> | void)[] = [];
  // Runs once, newest resource first.
  const closeAll = async () => { for (const step of cleanup.splice(0).reverse()) await step(); };
  let app: FastifyInstance | undefined;
  let report = (message: string, error?: unknown) => console.error(message, error instanceof Error ? error.message : error ?? "");
  try {
    const rpc = new HttpJsonRpc({ url: config.rpcUrl });
    cleanup.push(() => rpc.close());
    const manifest = parseManifest(JSON.parse(await readFile(config.manifestPath, "utf8")));
    if (manifest.chainId !== LIVE_CHAIN_ID) throw new Error(`The manifest is for chain ${manifest.chainId}; the live server serves Monad mainnet (${LIVE_CHAIN_ID}) only.`);
    const verified = await verifyManifest(rpc, manifest);
    const roster = config.rosterPath ? parseRoster(JSON.parse(await readFile(config.rosterPath, "utf8")), verified.deployment) : [];

    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    cleanup.push(() => pool.end());
    await migrate(pool);
    await refuseForeignMembers(pool, verified.deployment);

    const reader = new LiveChainReader({
      // Four log requests at once: about four times faster catching up from the activation block, and still
      // gentle on the public RPC. Each window is checked and stored as one range.
      rpc, store: new PgProjectionStore(pool), deployment: verified.deployment, parallelRequests: 4, ...options.reader,
      onError: (error) => report("Ownership reader:", error),
    });
    cleanup.push(() => reader.stop());
    let lastLog = 0;
    await reader.catchUp((progress) => {
      if (!progress.caughtUp && Date.now() - lastLog < 10_000) return;
      lastLog = Date.now();
      console.error(`Ownership projection at block ${progress.head.cursor.number} of ${progress.target.number}${progress.caughtUp ? " (caught up)" : ""}.`);
    });
    // Every roster Chog must be awakened under this adapter, and readable now.
    const observed = await Promise.all(roster.map(async (chog) => [chog, await reader.resolveAgent(chog.identity)] as const));
    const refused = observed.filter(([, observation]) => observation.kind === "not_awakened" || observation.kind === "unavailable");
    if (refused.length) {
      throw new Error(`Roster Chogs that are not awakened under the manifest's adapter, or whose ownership cannot be read: ${refused.map(([chog, o]) => `${chog.name} (${o.kind})`).join(", ")}.`);
    }
    reader.start();

    // City runs in this server unless CITY_API_URL names a separately hosted one.
    const remoteCity = config.cityUrl ? new HttpCityFeed({ baseUrl: config.cityUrl, onError: (error) => report("City feed:", error) }) : null;
    if (remoteCity) cleanup.push(() => remoteCity.stop());
    // Chog Soul: holder-funded AI. Credits come only from finalized $CHOG transfers to the treasury.
    const credits = new PgCredits(pool);
    const soulConfig = { ...DEFAULT_SOUL, model: config.soul.model ?? DEFAULT_SOUL.model };
    const provider = config.soul.openRouterKey ? new OpenRouterProvider({ apiKey: config.soul.openRouterKey, model: soulConfig.model, appUrl: config.origin }) : null;
    const soul = new SoulService({ pool, credits, provider, reader, config: soulConfig });
    const deposits = config.soul.treasury
      ? new DepositIndexer({ pool, rpc, credits, chainId: LIVE_CHAIN_ID, token: CHOG_TOKEN_MAINNET, treasury: config.soul.treasury, startBlock: config.soul.startBlock! })
      : null;
    await deposits?.initialize();
    const cult = new PgCult({ pool, reader, feed: remoteCity ?? new PgCityFeed(pool), soul });
    await cult.initialize(config.timing);
    await cult.registerChogs(roster);
    remoteCity?.start((await cult.runtime()).cityCursor);
    const city = remoteCity ? null : new PgCity({ pool, reader, cityId: "monad-mainnet" });
    if (city) {
      await city.initialize();
      const admission = await city.admitRoster(roster);
      if (admission.full.length) console.error(`City is full: ${admission.full.length} roster Chog(s) have no plot.`);
    }

    const auth: AuthConfig = {
      domain: new URL(config.origin).host, origin: config.origin, uri: config.origin, chainIds: [LIVE_CHAIN_ID], secureCookies: true,
      challengeTtlMs: 5 * 60_000, sessionTtlMs: 12 * 60 * 60_000,
    };
    const webRoot = options.webRoot === undefined ? fileURLToPath(new URL("../../web/dist/", import.meta.url)) : options.webRoot;
    const cityWebRoot = options.cityWebRoot === undefined ? fileURLToPath(new URL("../../../city/dist/", import.meta.url)) : options.cityWebRoot;
    // Holders bring an awakened Chog into City by token ID; its agent is read from the verified adapter.
    const cityDirectory = new LiveAgentDirectory({ rpc, deployment: verified.deployment, traitsOf: genesisTraits, onError: (error) => report("Agent lookup:", error) });
    // Chog Soul lists each holder's Chogs: the collection isn't enumerable, so this reads every token (cached).
    const holdings = new LiveHoldingsIndex({ rpc, deployment: verified.deployment, maxTokenId: GENESIS_MAX_TOKEN_ID, onError: (error) => report("Holdings index:", error) });
    const awaken = { chainId: LIVE_CHAIN_ID, adapter: verified.deployment.adapter };
    app = await buildServer({
      pool, logger: options.logger ?? true, cult, ...(city ? { city, cityDirectory, holdings, awaken, ...(cityWebRoot ? { cityWebRoot } : {}) } : {}), auth, ...(webRoot ? { webRoot } : {}),
      soul: {
        service: soul, credits, payment: { mode: "chog", chainId: LIVE_CHAIN_ID, token: CHOG_TOKEN_MAINNET, treasury: config.soul.treasury },
        bots: new ChogBrain({ pool, soul, reader, directory: cityDirectory }),
      },
      site: { mode: "live", label: "Monad mainnet", chainIds: auth.chainIds }, trustProxy: config.trustedProxies,
    });
    app.addHook("onClose", closeAll);
    const log = app.log;
    report = (message, error) => log.error({ err: error }, message);
    // The morning council runs after City's ticks; each Chog's AI is used only when its holder opted in.
    const council = city ? new CityCouncil(city, soul) : null;
    const scheduler = setInterval(() => {
      cult.runDue().catch((error: unknown) => log.error({ err: error }, "scheduler step failed"));
      city?.runDue()
        .then(() => council?.runIfDue())
        .then((held) => { if (held) log.info(held, "city council held"); })
        .catch((error: unknown) => log.error({ err: error }, "city tick failed"));
    }, options.schedulerMs ?? 1000);
    cleanup.push(() => clearInterval(scheduler));
    const soulJobs = setInterval(() => {
      deposits?.catchUp(5).catch((error: unknown) => log.error({ err: error }, "deposit indexer failed"));
      credits.refundStale(10 * 60_000).catch((error: unknown) => log.error({ err: error }, "credit sweep failed"));
    }, options.schedulerMs ? options.schedulerMs * 5 : 5000);
    cleanup.push(() => clearInterval(soulJobs));
    await app.listen({ host: config.host, port: config.port });
    // Chog Soul's first visitor shouldn't wait for a full read of the collection.
    holdings.warm();
    app.log.info({ chainId: LIVE_CHAIN_ID, adapter: verified.deployment.adapter, activationBlock: verified.deployment.activation.number.toString(), rpcHost: rpc.host, chogs: roster.length, trustedProxies: config.trustedProxies }, "live Cult started");
    const server = app;
    return { app: server, reader, cult, city, close: () => server.close() };
  } catch (error) {
    // Closing the app runs closeAll through its onClose hook.
    if (app) await app.close(); else await closeAll();
    throw error;
  }
}
