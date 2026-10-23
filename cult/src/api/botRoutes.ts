// Chog Bots for holders: profiles and skills (public), the bot's settings and activity log (holder only, ownership
// read fresh), and trying the bot on the web before it speaks anywhere public.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DECLINE_TEXT, MAX_SERVERS, type BotSettings, type ChogBrain } from "../bots/brain.js";
import { PROFILE_IDS, PROFILES, SKILL_IDS, SKILLS, type ProfileId, type SkillId } from "../bots/skills.js";
import type { Session } from "./auth.js";
import { RateLimiter } from "./rateLimit.js";

const AGENT_KEY_PATTERN = "^(31337|10143|143):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:(0|[1-9][0-9]{0,77}):(0|[1-9][0-9]{0,77})$";
const EPOCH_PATTERN = "^(0|[1-9][0-9]{0,77})$";
const STATUS: Readonly<Record<string, number>> = { NOT_FOUND: 404, NOT_CONTROLLER: 403, OWNERSHIP_UNAVAILABLE: 503, CONTROL_CHANGED: 409, INVALID_INPUT: 400 };

export interface BotRouteOptions {
  readonly brain: ChogBrain;
  readonly now: () => number;
  readonly session: (request: FastifyRequest) => Promise<Session>;
  readonly guarded: (request: FastifyRequest) => Promise<Session>;
  readonly fail: (statusCode: number, code: string, message: string) => Error;
}

type Refusal = { ok: false; code: string; message: string };
function send<T>(reply: FastifyReply, request: FastifyRequest, result: { ok: true; value: T } | Refusal, wrap: (value: T) => unknown): unknown {
  if (result.ok) return wrap(result.value);
  return reply.status(STATUS[result.code] ?? 400).send({ error: { code: result.code, message: result.message, requestId: request.id } });
}

const params = { type: "object", properties: { agentKey: { type: "string", pattern: AGENT_KEY_PATTERN } } } as const;

export function registerBotRoutes(app: FastifyInstance, options: BotRouteOptions): void {
  const { brain, now, session, guarded, fail } = options;
  const tryLimit = new RateLimiter(20, 60_000);

  app.get("/api/soul/bots/config", async () => ({
    profiles: PROFILE_IDS.map((id) => ({ id, ...PROFILES[id] })),
    skills: SKILL_IDS.map((id) => ({ id, name: SKILLS[id].name, description: SKILLS[id].description, input: SKILLS[id].input, maxInput: SKILLS[id].maxInput })),
    maxServers: MAX_SERVERS,
  }));

  app.get<{ Params: { agentKey: string } }>("/api/soul/chogs/:agentKey/bot", { schema: { params } }, async (request, reply) => {
    const found = await session(request);
    return send(reply, request, await brain.getSettings(found.address, request.params.agentKey), (settings) => ({ settings }));
  });

  app.put<{ Params: { agentKey: string }; Body: BotSettings & { expectedEpoch: string } }>("/api/soul/chogs/:agentKey/bot", {
    schema: {
      params,
      body: {
        type: "object", additionalProperties: false, required: ["enabled", "profile", "channels", "servers", "dailyReplies", "expectedEpoch"],
        properties: {
          enabled: { type: "boolean" }, profile: { enum: [...PROFILE_IDS] },
          channels: { type: "object", additionalProperties: false, properties: { web: { type: "boolean" }, discord: { type: "boolean" } } },
          servers: { type: "array", maxItems: MAX_SERVERS, items: { type: "string", pattern: "^[0-9]{15,21}$" } },
          dailyReplies: { type: "integer", minimum: 1, maximum: 200 }, expectedEpoch: { type: "string", pattern: EPOCH_PATTERN },
        },
      },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    const body = request.body;
    const result = await brain.setSettings(found.address, request.params.agentKey, { ...body, profile: body.profile as ProfileId, channels: { web: true, discord: Boolean(body.channels.discord) } });
    return send(reply, request, result, (settings) => ({ settings }));
  });

  app.get<{ Params: { agentKey: string } }>("/api/soul/chogs/:agentKey/bot/activity", { schema: { params } }, async (request, reply) => {
    const found = await session(request);
    return send(reply, request, await brain.activity(found.address, request.params.agentKey), (activity) => ({ activity }));
  });

  app.post<{ Params: { agentKey: string }; Body: { skill: SkillId; input: string } }>("/api/soul/chogs/:agentKey/bot/try", {
    schema: {
      params,
      body: { type: "object", additionalProperties: false, required: ["skill", "input"], properties: { skill: { enum: [...SKILL_IDS] }, input: { type: "string", maxLength: 4000 } } },
    },
  }, async (request, reply) => {
    const found = await guarded(request);
    if (!tryLimit.allow(`${found.sessionId}|bot`, now())) throw fail(429, "RATE_LIMITED", "Slow down a little; your Chog needs a breath.");
    const result = await brain.tryAsHolder(found.address, request.params.agentKey, request.body.skill, request.body.input);
    if ("code" in result) return reply.status(STATUS[result.code] ?? 400).send({ error: { code: result.code, message: result.message, requestId: request.id } });
    return result.ok ? { reply: result.reply } : { declined: result.reason, message: result.message ?? DECLINE_TEXT[result.reason] };
  });
}
