import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { formatChog, parseChog } from "../soul/config.js";
import type { PgCredits } from "../soul/credits.js";
import type { SoulErrorCode, SoulResult, SoulService } from "../soul/service.js";
import type { Session } from "./auth.js";
import { RateLimiter } from "./rateLimit.js";

const AGENT_KEY_PATTERN = "^(31337|10143|143):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:(0|[1-9][0-9]{0,77}):(0|[1-9][0-9]{0,77})$";
const EPOCH_PATTERN = "^(0|[1-9][0-9]{0,77})$";

const STATUS: Readonly<Record<SoulErrorCode, number>> = {
  INVALID_INPUT: 400, NOT_CONTROLLER: 403, OWNERSHIP_UNAVAILABLE: 503, CONTROL_CHANGED: 409, AI_UNAVAILABLE: 503,
  INSUFFICIENT_CREDITS: 402, PROVIDER_FAILED: 502, IDEMPOTENCY_CONFLICT: 409,
};

export interface PaymentInfo {
  /** "chog" when holders top up with $CHOG on chain; "fixture" when credits are granted locally. */
  readonly mode: "chog" | "fixture";
  readonly chainId: number;
  readonly token: string | null;
  readonly treasury: string | null;
}

export interface SoulRouteOptions {
  readonly soul: SoulService;
  readonly credits: PgCredits;
  readonly payment: PaymentInfo;
  readonly now: () => number;
  /** Holder guards from the auth routes, so Soul uses the same session, Origin and CSRF checks. */
  readonly session: (request: FastifyRequest) => Promise<Session>;
  readonly guarded: (request: FastifyRequest) => Promise<Session>;
  readonly idempotencyKey: (request: FastifyRequest) => string;
  readonly fail: (statusCode: number, code: string, message: string) => Error;
}

function send<T>(reply: FastifyReply, request: FastifyRequest, result: SoulResult<T>, wrap: (value: T) => unknown): unknown {
  if (result.ok) return wrap(result.value);
  return reply.status(STATUS[result.code]).send({ error: { code: result.code, message: result.message, requestId: request.id } });
}

/** Chog Soul: public persona and prices, the holder's credit account, AI consent per Chog, and holder chat. */
export function registerSoulRoutes(app: FastifyInstance, options: SoulRouteOptions): void {
  const { soul, credits, payment, now, session, guarded, idempotencyKey, fail } = options;
  const chatLimit = new RateLimiter(20, 60_000);
  const config = soul.config;

  app.get("/api/soul/config", async () => ({
    ai: soul.aiAvailable, model: config.model, payment,
    prices: { chat: formatChog(config.prices.chat), debate: formatChog(config.prices.debate), vote: formatChog(config.prices.vote) },
    defaultDailyCap: formatChog(config.defaultDailyCap), maxDailyCap: formatChog(config.maxDailyCap),
  }));

  app.get<{ Params: { agentKey: string } }>("/api/soul/chogs/:agentKey", {
    schema: { params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } } },
  }, async (request) => {
    const persona = await soul.persona(request.params.agentKey);
    if (!persona) throw fail(404, "NOT_FOUND", "Unknown Chog.");
    return { persona };
  });

  app.get("/api/soul/me", async (request) => {
    const found = await session(request);
    const account = await credits.account(found.address);
    return {
      address: found.address, balance: formatChog(account.balance), held: formatChog(account.held),
      usage: (await credits.recentUsage(found.address)).map((entry) => ({ ...entry, price: formatChog(entry.price) })),
      deposits: (await credits.recentDeposits(found.address)).map((entry) => ({ ...entry, amount: formatChog(entry.amount) })),
    };
  });

  app.get<{ Params: { agentKey: string } }>("/api/soul/chogs/:agentKey/private", {
    schema: { params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } } },
  }, async (request, reply) => {
    const found = await session(request);
    const history = await soul.history(found.address, request.params.agentKey);
    if (!history.ok) return send(reply, request, history, () => null);
    const settings = await soul.settings(request.params.agentKey, history.value.epoch);
    return {
      epoch: history.value.epoch, messages: history.value.messages,
      settings: { aiEnabled: settings.aiEnabled, dailyCap: formatChog(settings.dailyCap), spentToday: formatChog(await credits.spentToday(request.params.agentKey)) },
    };
  });

  app.put<{ Params: { agentKey: string }; Body: { aiEnabled: boolean; dailyCap: string; expectedEpoch: string } }>("/api/soul/chogs/:agentKey/settings", {
    schema: {
      params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } },
      body: {
        type: "object", additionalProperties: false, required: ["aiEnabled", "dailyCap", "expectedEpoch"],
        properties: { aiEnabled: { type: "boolean" }, dailyCap: { type: "string", maxLength: 40 }, expectedEpoch: { type: "string", pattern: EPOCH_PATTERN } },
      },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    let dailyCap: bigint;
    try { dailyCap = parseChog(request.body.dailyCap); } catch (error) { throw fail(400, "INVALID_INPUT", (error as Error).message); }
    const result = await soul.setSettings(found.address, request.params.agentKey, { aiEnabled: request.body.aiEnabled, dailyCap, expectedEpoch: request.body.expectedEpoch });
    return send(reply, request, result, (saved) => ({ settings: { aiEnabled: saved.aiEnabled, dailyCap: formatChog(saved.dailyCap) } }));
  });

  app.post<{ Params: { agentKey: string }; Body: { message: string } }>("/api/soul/chogs/:agentKey/chat", {
    schema: {
      params: { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } },
      body: { type: "object", additionalProperties: false, required: ["message"], properties: { message: { type: "string", minLength: 1, maxLength: 500 } } },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    const key = idempotencyKey(request);
    if (!chatLimit.allow(`${found.sessionId}|${request.params.agentKey}`, now())) throw fail(429, "RATE_LIMITED", "Slow down a little; your Chog needs a breath.");
    const result = await soul.chat(found.address, request.params.agentKey, request.body.message, `${found.sessionId}:${key}`);
    return send(reply, request, result, (value) => value);
  });
}
