import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import type { PgCult } from "../db/pgCult.js";
import type { CityErrorCode, CityResult, PgCity } from "../citysim/pgCity.js";
import type { AgentDirectory } from "../chain/agentDirectory.js";
import type { HoldingsIndex } from "../chain/holdings.js";
import { registerAwakenRoutes } from "./awakenRoutes.js";
import { DECOR_IDS, FOCUSES, HOME_STYLES, cityActionSchema, instructionsRequestSchema, jobRequestSchema, joinRequestSchema, type CityAction, type DecorId, type Focus, type HomeStyle } from "../citysim/world.js";
import { FACTIONS, PLACES, type FactionId, type Place, type Stance } from "../rules.js";
import { makeAgentKey, type AgentKey } from "../shared/identity.js";
import type { CultErrorCode, Result } from "../engine/types.js";
import { SESSION_COOKIE, createChallenge, csrfMatches, findSession, readCookie, revokeSession, sessionCookie, verifyLogin, type AuthConfig, type Session } from "./auth.js";
import { RateLimiter } from "./rateLimit.js";
import { registerSoulRoutes, type PaymentInfo } from "./soulRoutes.js";
import { registerBotRoutes } from "./botRoutes.js";
import type { ChogBrain } from "../bots/brain.js";
import type { SoulService } from "../soul/service.js";
import type { PgCredits } from "../soul/credits.js";

const AGENT_KEY_PATTERN = "^(31337|10143|143):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:(0|[1-9][0-9]{0,77}):(0|[1-9][0-9]{0,77})$";
const EPOCH_PATTERN = "^(0|[1-9][0-9]{0,77})$";
const MINUTE = 60_000;

const STATUS: Readonly<Record<CultErrorCode | CityErrorCode, number>> = {
  INVALID_INPUT: 400, NOT_CONTROLLER: 403, SWITCH_COOLDOWN: 409, NOT_ELIGIBLE: 409, VOTING_CLOSED: 409,
  CONTROL_CHANGED: 409, IDEMPOTENCY_CONFLICT: 409, OWNERSHIP_UNAVAILABLE: 503, POLICY_CHANGED: 409, CITY_FULL: 409,
  NOT_FOUND: 404, NOT_AWAKENED: 409, ALREADY_OWNED: 409, DECOR_FULL: 409, CANT_AFFORD: 409,
  DISTRICT_FULL: 409, NOT_A_CITIZEN: 409, JOB_CHANGED: 409, NOT_ENOUGH: 409, NO_ROOM: 409, TREASURY_EMPTY: 409, MARKET_EMPTY: 409,
  NO_OFFER: 409, OFFER_TAKEN: 409, NOT_NEEDED: 409, NOT_ALLOWED: 400, CANT_VOTE_YET: 409, VOTE_CLOSED: 409, TOO_MANY_PROPOSALS: 409,
};

export class HttpError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

export interface HolderRouteOptions {
  readonly pool: pg.Pool;
  readonly cult: PgCult;
  /** When set, the holder's City routes (their residents, settings) are registered too. */
  readonly city?: PgCity;
  /** With `city`: finds a token's agent on chain, so holders can bring a Chog into City by token ID. */
  readonly cityDirectory?: AgentDirectory;
  /** With `cityDirectory`: the holder's Chogs for Chog Soul, and (live) the awakening call. */
  readonly holdings?: HoldingsIndex;
  readonly awaken?: { readonly chainId: number; readonly adapter: string };
  /** When set, Chog Soul's holder routes (credits, AI consent, chat) are registered too. */
  readonly soul?: { readonly service: SoulService; readonly credits: PgCredits; readonly payment: PaymentInfo; readonly bots?: ChogBrain };
  readonly auth: AuthConfig;
  readonly now: () => number;
}

function sendResult<T>(reply: FastifyReply, request: FastifyRequest, result: Result<T> | CityResult<T>, wrap: (value: T) => unknown): unknown {
  if (result.ok) return wrap(result.value);
  return reply.status(STATUS[result.code]).send({ error: { code: result.code, message: result.message, requestId: request.id } });
}

/** Login (SIWE), logout, the holder's own Chogs, and the two holder actions. */
export function registerHolderRoutes(app: FastifyInstance, options: HolderRouteOptions): void {
  const { pool, cult, city, cityDirectory, holdings, awaken, soul, auth, now } = options;
  const challengeLimit = new RateLimiter(20, 15 * MINUTE);
  const verifyLimit = new RateLimiter(10, 15 * MINUTE);
  const actionLimit = new RateLimiter(10, MINUTE);

  async function session(request: FastifyRequest): Promise<Session> {
    const found = await findSession(pool, readCookie(request.headers.cookie, SESSION_COOKIE), now());
    if (!found) throw new HttpError(401, "LOGIN_REQUIRED", "Sign in with your wallet first.");
    return found;
  }

  /** State-changing requests need the exact configured Origin, a live session, and its CSRF token. */
  async function guarded(request: FastifyRequest): Promise<Session> {
    if (request.headers.origin !== auth.origin) throw new HttpError(403, "ORIGIN_REJECTED", "This request did not come from the Chog Cult site.");
    const found = await session(request);
    const csrf = request.headers["x-csrf-token"];
    if (!csrfMatches(found, typeof csrf === "string" ? csrf : undefined)) throw new HttpError(403, "CSRF_FAILED", "Missing or wrong CSRF token; reload the page.");
    return found;
  }

  function idempotencyKey(request: FastifyRequest): string {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new HttpError(400, "INVALID_INPUT", "Send an Idempotency-Key header of 8-128 letters, digits, '-' or '_'.");
    return key;
  }

  const requestHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

  app.post<{ Body: { address: string; chainId: number } }>("/api/auth/challenge", {
    schema: { body: { type: "object", additionalProperties: false, required: ["address", "chainId"], properties: { address: { type: "string", maxLength: 42 }, chainId: { type: "integer" } } } },
  }, async (request, reply) => {
    if (!challengeLimit.allow(request.ip, now())) throw new HttpError(429, "RATE_LIMITED", "Too many sign-in attempts; wait a few minutes.");
    const result = await createChallenge(pool, auth, request.body.address, request.body.chainId, now());
    if (!result.ok) return reply.status(400).send({ error: { code: result.code, message: result.message, requestId: request.id } });
    return result.value;
  });

  app.post<{ Body: { message: string; signature: string } }>("/api/auth/verify", {
    schema: { body: { type: "object", additionalProperties: false, required: ["message", "signature"], properties: { message: { type: "string", maxLength: 2048 }, signature: { type: "string", maxLength: 140 } } } },
  }, async (request, reply) => {
    if (!verifyLimit.allow(request.ip, now())) throw new HttpError(429, "RATE_LIMITED", "Too many sign-in attempts; wait a few minutes.");
    const result = await verifyLogin(pool, auth, request.body.message, request.body.signature, now());
    if (!result.ok) return reply.status(401).send({ error: { code: result.code, message: result.message, requestId: request.id } });
    const created = result.value;
    reply.header("set-cookie", sessionCookie(created.token, auth, created.expiresAtMs - now()));
    return { address: created.address, chainId: created.chainId, csrfToken: created.csrfToken, expiresAt: new Date(created.expiresAtMs).toISOString() };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const found = await guarded(request);
    await revokeSession(pool, found.sessionId, now());
    // Ends the human session only; Chogs keep following their saved stance.
    reply.header("set-cookie", sessionCookie("", auth, 0));
    return { loggedOut: true };
  });

  app.get("/api/me", async (request) => {
    const found = await session(request);
    const { rows } = await pool.query(
      "SELECT agent_key, name, faction, stance, joined_cycle, ownership_epoch, control_status FROM members WHERE controller = $1 ORDER BY agent_key", [found.address]);
    return {
      address: found.address, chainId: found.chainId, expiresAt: new Date(found.expiresAtMs).toISOString(),
      // Last observed control; every action re-checks ownership before it changes anything.
      chogs: rows.map((row) => ({ agentKey: row.agent_key, name: row.name, faction: row.faction, stance: row.stance, joinedCycle: row.joined_cycle, ownershipEpoch: String(row.ownership_epoch), control: row.control_status })),
    };
  });

  app.put<{ Params: { agentKey: string }; Body: { faction?: FactionId | null; stance?: Stance; expectedEpoch: string } }>("/api/cult/members/:agentKey", {
    schema: {
      params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } },
      body: {
        type: "object", additionalProperties: false, required: ["expectedEpoch"], minProperties: 2,
        properties: { faction: { enum: [...FACTIONS, null] }, stance: { enum: ["persona", "abstain"] }, expectedEpoch: { type: "string", pattern: EPOCH_PATTERN } },
      },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    const key = idempotencyKey(request);
    const { agentKey } = request.params;
    if (!actionLimit.allow(`${found.sessionId}|${agentKey}`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many changes for this Chog; wait a minute.");
    const { expectedEpoch, ...change } = request.body;
    const result = await cult.setMembership(found.address, agentKey as AgentKey, change, {
      expectedEpoch, idempotency: { sessionId: found.sessionId, key, requestHash: requestHash({ agentKey, ...request.body }) },
    });
    return sendResult(reply, request, result, (member) => ({ member }));
  });

  app.put<{ Params: { cycle: string; agentKey: string; place: Place }; Body: { decreeId: string | null; expectedEpoch: string } }>("/api/cult/votes/:cycle/:agentKey/:place", {
    schema: {
      params: { type: "object", properties: { cycle: { type: "string", pattern: "^(0|[1-9][0-9]{0,8})$" }, agentKey: { type: "string", pattern: AGENT_KEY_PATTERN }, place: { enum: [...PLACES] } } },
      body: {
        type: "object", additionalProperties: false, required: ["decreeId", "expectedEpoch"],
        properties: { decreeId: { anyOf: [{ type: "string", pattern: "^[a-z-]{3,40}$" }, { type: "null" }] }, expectedEpoch: { type: "string", pattern: EPOCH_PATTERN } },
      },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    const key = idempotencyKey(request);
    const { cycle, agentKey, place } = request.params;
    if (!actionLimit.allow(`${found.sessionId}|${agentKey}`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many changes for this Chog; wait a minute.");
    const result = await cult.override(found.address, agentKey as AgentKey, place, request.body.decreeId, {
      expectedEpoch: request.body.expectedEpoch, expectedCycle: Number(cycle),
      idempotency: { sessionId: found.sessionId, key, requestHash: requestHash({ cycle, agentKey, place, ...request.body }) },
    });
    return sendResult(reply, request, result, (vote) => ({ vote }));
  });

  if (soul) {
    registerSoulRoutes(app, {
      soul: soul.service, credits: soul.credits, payment: soul.payment, now, session, guarded, idempotencyKey,
      fail: (statusCode, code, message) => new HttpError(statusCode, code, message),
    });
    if (soul.bots) {
      registerBotRoutes(app, { brain: soul.bots, now, session, guarded, fail: (statusCode, code, message) => new HttpError(statusCode, code, message) });
    }
  }

  if (city) {
    app.patch<{ Params: { agentKey: string }; Body: { expectedVersion: string; expectedEpoch: string; active: boolean; focus: Focus; homeStyle: HomeStyle } }>("/api/city/agents/:agentKey/policy", {
      schema: {
        params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } },
        body: {
          type: "object", additionalProperties: false, required: ["expectedVersion", "expectedEpoch", "active", "focus", "homeStyle"],
          properties: {
            expectedVersion: { type: "string", pattern: EPOCH_PATTERN }, expectedEpoch: { type: "string", pattern: EPOCH_PATTERN },
            active: { type: "boolean" }, focus: { enum: [...FOCUSES] }, homeStyle: { enum: [...HOME_STYLES] },
          },
        },
      },
    }, async (request, reply) => {
      const found = await guarded(request);
      const key = idempotencyKey(request);
      const { agentKey } = request.params;
      if (!actionLimit.allow(`${found.sessionId}|${agentKey}`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many changes for this Chog; wait a minute.");
      const { expectedVersion, expectedEpoch, ...policy } = request.body;
      const result = await city.setPolicy(found.address, agentKey, policy, {
        expectedVersion, expectedEpoch, idempotency: { sessionId: found.sessionId, key, requestHash: requestHash({ agentKey, ...request.body }) },
      });
      return sendResult(reply, request, result, (agent) => ({ agent }));
    });

    app.post<{ Params: { agentKey: string }; Body: { expectedEpoch: string; item: DecorId } }>("/api/city/agents/:agentKey/decor", {
      schema: {
        params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } },
        body: {
          type: "object", additionalProperties: false, required: ["expectedEpoch", "item"],
          properties: { expectedEpoch: { type: "string", pattern: EPOCH_PATTERN }, item: { enum: [...DECOR_IDS] } },
        },
      },
    }, async (request, reply) => {
      const found = await guarded(request);
      const key = idempotencyKey(request);
      const { agentKey } = request.params;
      if (!actionLimit.allow(`${found.sessionId}|${agentKey}`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many changes for this Chog; wait a minute.");
      const result = await city.decorate(found.address, agentKey, request.body.item, {
        expectedEpoch: request.body.expectedEpoch, idempotency: { sessionId: found.sessionId, key, requestHash: requestHash({ agentKey, ...request.body }) },
      });
      return sendResult(reply, request, result, (agent) => ({ agent }));
    });

    /** City's own request schemas (zod), so the server accepts exactly what City's clients send. */
    const parse = <T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, body: unknown): T => {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "Invalid request.");
      return parsed.data;
    };
    const playerLimit = new RateLimiter(30, MINUTE);

    // Citizens: anyone signed in with a wallet, Chog NFT or not.
    app.get("/api/city/citizens/me", async (request) => {
      const found = await session(request);
      return { citizen: (await city.citizen(found.address)) ?? null };
    });

    app.post("/api/city/citizens", async (request, reply) => {
      const found = await guarded(request);
      const key = idempotencyKey(request);
      if (!playerLimit.allow(`${found.sessionId}|player`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many requests; wait a minute.");
      const body = parse(joinRequestSchema, request.body);
      const result = await city.joinCity(found.address, body, { sessionId: found.sessionId, key, requestHash: requestHash(body) });
      return sendResult(reply, request, result, (citizen) => ({ citizen }));
    });

    app.patch("/api/city/citizens/me/job", async (request, reply) => {
      const found = await guarded(request);
      const key = idempotencyKey(request);
      if (!playerLimit.allow(`${found.sessionId}|player`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many requests; wait a minute.");
      const body = parse(jobRequestSchema, request.body);
      const result = await city.setJob(found.address, body, { sessionId: found.sessionId, key, requestHash: requestHash(body) });
      return sendResult(reply, request, result, (citizen) => ({ citizen }));
    });

    // A holder's private standing instructions for their Chog's council turns.
    app.get<{ Params: { agentKey: string } }>("/api/city/agents/:agentKey/instructions", {
      schema: { params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } } },
    }, async (request, reply) => {
      const found = await session(request);
      const result = await city.getInstructions(found.address, request.params.agentKey);
      return sendResult(reply, request, result, (text) => ({ text }));
    });

    app.put<{ Params: { agentKey: string } }>("/api/city/agents/:agentKey/instructions", {
      schema: { params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } } },
    }, async (request, reply) => {
      const found = await guarded(request);
      if (!playerLimit.allow(`${found.sessionId}|player`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many requests; wait a minute.");
      const body = parse(instructionsRequestSchema, request.body);
      const result = await city.setInstructions(found.address, request.params.agentKey, body);
      return sendResult(reply, request, result, (text) => ({ text }));
    });

    // The economy: gifts, market trades, job offers, taking an offer, project contributions.
    app.post("/api/city/actions", async (request, reply) => {
      const found = await guarded(request);
      const key = idempotencyKey(request);
      if (!playerLimit.allow(`${found.sessionId}|player`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many requests; wait a minute.");
      const body = parse(cityActionSchema, request.body) as CityAction;
      const result = await city.act(found.address, body, { sessionId: found.sessionId, key, requestHash: requestHash(body) });
      return sendResult(reply, request, result, () => ({ ok: true }));
    });

    app.get("/api/city/me/agents", async (request) => {
      const found = await session(request);
      // Last verified controller; settings and admissions re-check ownership before changing anything.
      return { address: found.address, agents: await city.agentsOf(found.address) };
    });

    if (cityDirectory && holdings) {
      registerAwakenRoutes(app, {
        pool, holdings, directory: cityDirectory, ...(awaken ? { awaken } : {}), session,
        fail: (statusCode, code, message) => new HttpError(statusCode, code, message),
      });
    }

    if (cityDirectory) {
      app.post<{ Body: { tokenId: string } }>("/api/city/admissions", {
        schema: { body: { type: "object", additionalProperties: false, required: ["tokenId"], properties: { tokenId: { type: "string", pattern: EPOCH_PATTERN } } } },
      }, async (request, reply) => {
        const found = await guarded(request);
        if (!actionLimit.allow(`${found.sessionId}|city-admission`, now())) throw new HttpError(429, "RATE_LIMITED", "Too many requests; wait a minute.");
        const { tokenId } = request.body;
        // The agent comes from the verified adapter, never from the request.
        const lookup = await cityDirectory.lookup(tokenId);
        if (lookup.kind === "unavailable") throw new HttpError(503, "OWNERSHIP_UNAVAILABLE", "The chain can't be read right now; try again shortly.");
        if (lookup.kind === "not_awakened") throw new HttpError(409, "NOT_AWAKENED", `Chog #${tokenId} isn't awakened yet. Awaken it in Chog Soul (/soul/), then bring it in.`);
        const result = await city.admitByHolder(found.address, { identity: lookup.identity, name: lookup.name });
        // City has a fixed number of plots. When they're all taken the holder's Chog still joins the Cult and its
        // Soul (CITY_FULL is checked after the holder check, so it means the caller holds this Chog).
        if (!result.ok && result.code !== "CITY_FULL") return sendResult(reply, request, result, (agent) => ({ agent }));
        // A City resident is also a Cult member, unaligned until its holder picks a faction. Both steps are
        // idempotent, so bringing the Chog in again finishes an arrival that stopped halfway.
        try {
          await cult.registerChogs([{ name: lookup.name, identity: lookup.identity, agentKey: makeAgentKey(lookup.identity), traits: lookup.traits }]);
        } catch (error) {
          request.log.error({ err: error }, "Cult registration after City admission failed");
          throw new HttpError(503, "TRY_AGAIN", "Your Chog moved into City but couldn't join the Cult just now. Bring it in again to finish.");
        }
        holdings?.invalidate();
        if (!result.ok) throw new HttpError(409, "CITY_FULL", `Every plot in City is taken, so ${lookup.name} can't move in yet. It joined Chog Cult and Chog Soul.`);
        return { agent: result.value };
      });
    }
  }
}
