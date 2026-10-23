import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type pg from "pg";
import { CULT_EVENTS, DEFAULT_SSE, EventHub, serveStream, type SseOptions } from "./events.js";
import { readSnapshot } from "./readModel.js";
import { HttpError, registerHolderRoutes } from "./holderRoutes.js";
import type { ChogBrain } from "../bots/brain.js";
import type { AuthConfig } from "./auth.js";
import type { PgCult } from "../db/pgCult.js";
import type { PgCity } from "../citysim/pgCity.js";
import type { AgentDirectory } from "../chain/agentDirectory.js";
import type { HoldingsIndex } from "../chain/holdings.js";
import { CITY_EVENTS, readCitySnapshot } from "../citysim/readModel.js";
import type { CityEvent } from "../city/contract.js";
import type { SoulService } from "../soul/service.js";
import type { PgCredits } from "../soul/credits.js";
import type { PaymentInfo } from "./soulRoutes.js";

const AGENT_KEY = /^(31337|10143|143):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:(0|[1-9][0-9]{0,77}):(0|[1-9][0-9]{0,77})$/;
// Longest canonical agent key: 5-digit chain, three addresses and two 78-digit uint256 values.
const MAX_AGENT_KEY_LENGTH = 5 + 3 * 42 + 2 * 78 + 5;


export interface ServerOptions {
  readonly pool: pg.Pool;
  readonly sse?: Partial<SseOptions>;
  readonly logger?: boolean;
  /** With both, holder login and actions are enabled. */
  readonly cult?: PgCult;
  /** Chog City in the same server: its public reads, its event stream and (with auth) holder settings. */
  readonly city?: PgCity;
  /** With `city`: token → agent lookups, for holders bringing a Chog into City. */
  readonly cityDirectory?: AgentDirectory;
  /** With `cityDirectory`: the holder's Chogs for Chog Soul's page. */
  readonly holdings?: HoldingsIndex;
  /** Live only: the chain and adapter awakening transactions go to. */
  readonly awaken?: { readonly chainId: number; readonly adapter: string };
  /** Chog Soul: AI chat, consent and the $CHOG credit account. Needs auth. */
  readonly soul?: { readonly service: SoulService; readonly credits: PgCredits; readonly payment: PaymentInfo; readonly bots?: ChogBrain };
  readonly auth?: AuthConfig;
  readonly now?: () => number;
  /** Public site settings for the UI: how to label the mode, and which chain IDs sign-in accepts. */
  readonly site?: SiteConfig;
  /** Directory of the built web UI: / (landing), /soul/ and /cult/. */
  readonly webRoot?: string;
  /** Directory of Chog City's built UI (../city, `build:server`), served at /city/. */
  readonly cityWebRoot?: string;
  /**
   * IP addresses or CIDR ranges of the reverse proxy in front, e.g. ["127.0.0.1"]. Only requests from these
   * peers have their client address (request.ip, which keys the sign-in rate limits) taken from X-Forwarded-For.
   * Absent or empty trusts no one. Never a blanket `true`; hop counts don't work either (Fastify trusts no one for them).
   */
  readonly trustProxy?: readonly string[];
}

export interface SiteConfig {
  readonly mode: "fixture" | "live";
  readonly label: string;
  readonly chainIds: readonly number[];
}

/** Chog Cult API: public reads and events, plus holder login and actions when `cult` and `auth` are given. */
export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  // Checked before anything starts, so a missing build never leaves pollers running.
  if (options.cityWebRoot && !existsSync(join(options.cityWebRoot, "index.html"))) {
    throw new Error(`Chog City's UI is not built at ${options.cityWebRoot}. Run: npm.cmd --prefix ../city run build:server`);
  }
  const sse: SseOptions = { ...DEFAULT_SSE, ...options.sse };
  const { pool } = options;
  const app = Fastify({
    logger: options.logger ?? false, bodyLimit: 16 * 1024, forceCloseConnections: true,
    routerOptions: { maxParamLength: MAX_AGENT_KEY_LENGTH },
    trustProxy: options.trustProxy?.length ? [...options.trustProxy] : false,
  });
  const clients = new Set<{ close(): void }>();
  const hub = new EventHub(pool, sse.pollMs, (error) => app.log.error({ err: error }, "event poll failed"));
  await hub.start();
  const cityHub = options.city ? new EventHub<CityEvent>(pool, sse.pollMs, (error) => app.log.error({ err: error }, "city event poll failed"), CITY_EVENTS) : null;
  await cityHub?.start();
  app.addHook("onClose", async () => {
    hub.stop();
    cityHub?.stop();
    for (const client of clients) client.close();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError) return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, requestId: request.id } });
    const status = (error as { statusCode?: number }).statusCode;
    if ((error as { validation?: unknown }).validation || (status !== undefined && status >= 400 && status < 500)) {
      return reply.status(status === 413 || status === 415 ? status : 400).send({ error: { code: "INVALID_INPUT", message: (error as Error).message, requestId: request.id } });
    }
    request.log.error({ err: error }, "request failed");
    return reply.status(500).send({ error: { code: "INTERNAL", message: "Something went wrong.", requestId: request.id } });
  });
  app.setNotFoundHandler((request, reply) => reply.status(404).send({ error: { code: "NOT_FOUND", message: "No such route.", requestId: request.id } }));

  app.get("/api/health", async (_request, reply) => {
    try {
      const { rows } = await pool.query<{ revision: string }>("SELECT revision FROM cult_runtime WHERE id = 1");
      if (!rows[0]) throw new Error("not initialized");
      return { status: "ok", revision: String(rows[0].revision) };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  const site: SiteConfig = options.site ?? { mode: "fixture", label: "Fixture Village", chainIds: options.auth?.chainIds ?? [] };
  app.get("/api/cult/config", async () => ({
    ...site, login: Boolean(options.cult && options.auth), city: Boolean(options.city),
    // People without a Chog can join City as citizens wherever City and sign-in both run.
    citizens: Boolean(options.city && options.cult && options.auth),
  }));

  if (cityHub) {
    app.get("/api/city/snapshot", async () => readCitySnapshot(pool));
    app.get<{ Params: { agentKey: string } }>("/api/city/agents/:agentKey", async (request) => {
      const { agentKey } = request.params;
      if (!AGENT_KEY.test(agentKey)) throw new HttpError(400, "INVALID_INPUT", "agentKey must be chainId:registry:adapter:collection:tokenId:agentId in canonical form.");
      const agent = await options.city!.agent(agentKey);
      if (!agent) throw new HttpError(404, "NOT_FOUND", "That Chog does not live in City.");
      return { agent };
    });
    app.get<{ Querystring: { after?: string } }>("/api/city/events", (request, reply) => serveStream(request, reply, {
      pool, hub: cityHub, source: CITY_EVENTS, sse, clients,
      invalidCursor: () => new HttpError(400, "INVALID_INPUT", "The event cursor must be a revision number."),
    }));
  }

  app.get("/api/cult/snapshot", async () => readSnapshot(pool));
  app.get("/api/cult/places", async () => {
    const snapshot = await readSnapshot(pool);
    return { revision: snapshot.revision, cycle: snapshot.cycle, places: snapshot.places };
  });
  app.get("/api/cult/factions", async () => {
    const snapshot = await readSnapshot(pool);
    return { revision: snapshot.revision, factions: snapshot.factions };
  });
  app.get<{ Params: { agentKey: string } }>("/api/cult/agents/:agentKey", async (request) => {
    const { agentKey } = request.params;
    if (!AGENT_KEY.test(agentKey)) throw new HttpError(400, "INVALID_INPUT", "agentKey must be chainId:registry:adapter:collection:tokenId:agentId in canonical form.");
    const snapshot = await readSnapshot(pool);
    const member = snapshot.members.find((entry) => entry.agentKey === agentKey);
    if (!member) throw new HttpError(404, "NOT_FOUND", "That Chog is not part of the Cult.");
    return { revision: snapshot.revision, cycle: snapshot.cycle, phase: snapshot.phase, member };
  });

  app.get<{ Querystring: { after?: string } }>("/api/cult/events", (request, reply) => serveStream(request, reply, {
    pool, hub, source: CULT_EVENTS, sse, clients,
    invalidCursor: () => new HttpError(400, "INVALID_INPUT", "The event cursor must be a revision number."),
  }));

  if (options.cult && options.auth) {
    registerHolderRoutes(app, {
      pool, cult: options.cult, ...(options.city ? { city: options.city } : {}), ...(options.cityDirectory ? { cityDirectory: options.cityDirectory } : {}),
      ...(options.holdings ? { holdings: options.holdings } : {}), ...(options.awaken ? { awaken: options.awaken } : {}),
      ...(options.soul ? { soul: options.soul } : {}),
      auth: options.auth, now: options.now ?? Date.now,
    });
  }
  if (options.webRoot) {
    // Landing and Soul share a build; Cult now lives inside City's interface.
    await app.register(fastifyStatic, { root: options.webRoot, prefix: "/", index: "index.html" });
  }
  for (const path of ["/cult", "/cult/", "/cult/index.html"]) {
    app.get(path, async (_request, reply) => reply.redirect("/city/?tab=cult", 301));
  }
  if (options.cityWebRoot) {
    await app.register(fastifyStatic, { root: options.cityWebRoot, prefix: "/city/", index: "index.html", decorateReply: false });
  }
  return app;
}
