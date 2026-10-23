import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import type { AgentDirectory } from "../chain/agentDirectory.js";
import type { HoldingsIndex } from "../chain/holdings.js";
import { genesisImageUrl } from "../citysim/world.js";
import { makeAgentKey } from "../shared/identity.js";
import { awakenPlan } from "../soul/awakening.js";
import type { Session } from "./auth.js";

const TOKEN_ID = "^[1-9][0-9]{0,5}$";

export interface AwakenRouteOptions {
  readonly pool: pg.Pool;
  readonly holdings: HoldingsIndex;
  readonly directory: AgentDirectory;
  /** Live only: where awakening transactions go. Fixture mode has no chain to send them to. */
  readonly awaken?: { readonly chainId: number; readonly adapter: string };
  readonly session: (request: FastifyRequest) => Promise<Session>;
  readonly fail: (statusCode: number, code: string, message: string) => Error;
}

/** Chog Soul's front door: the signed-in holder's Chogs, whether a token is awake, and how to awaken one. */
export function registerAwakenRoutes(app: FastifyInstance, options: AwakenRouteOptions): void {
  const { pool, holdings, directory, awaken, session, fail } = options;
  const tokenParams = { type: "object", properties: { tokenId: { type: "string", pattern: TOKEN_ID } } } as const;

  app.get("/api/soul/holdings", async (request) => {
    const found = await session(request);
    const result = await holdings.holdingsOf(found.address);
    if (result.kind === "unavailable") throw fail(503, "OWNERSHIP_UNAVAILABLE", "Your Chogs can't be read from the chain right now; try again shortly.");
    const keyed = result.tokens.map((token) => ({ ...token, agentKey: token.identity ? makeAgentKey(token.identity) : null }));
    const keys = keyed.flatMap((token) => (token.agentKey ? [token.agentKey] : []));
    const members = new Map((keys.length ? (await pool.query<{ agent_key: string; name: string }>(
      "SELECT agent_key, name FROM members WHERE agent_key = ANY($1)", [keys])).rows : []).map((row) => [row.agent_key, row.name]));
    const residents = new Map((keys.length ? (await pool.query<{ agent_key: string; plot_id: string }>(
      "SELECT agent_key, plot_id FROM city_agents WHERE agent_key = ANY($1)", [keys])).rows : []).map((row) => [row.agent_key, row.plot_id]));
    return {
      address: found.address, blockNumber: result.blockNumber, awakening: Boolean(awaken),
      chogs: keyed.sort((a, b) => Number(a.tokenId) - Number(b.tokenId)).map((token) => ({
        tokenId: token.tokenId,
        name: (token.agentKey && members.get(token.agentKey)) || `Chog #${token.tokenId}`,
        image: genesisImageUrl(token.tokenId),
        awakened: token.agentKey !== null,
        agentKey: token.agentKey,
        inCult: token.agentKey !== null && members.has(token.agentKey),
        inCity: token.agentKey !== null && residents.has(token.agentKey),
        plotId: (token.agentKey && residents.get(token.agentKey)) ?? null,
      })),
    };
  });

  // Fresh from the chain (not the cached holdings), for waiting on an awakening to land.
  app.get<{ Params: { tokenId: string } }>("/api/soul/tokens/:tokenId", { schema: { params: tokenParams } }, async (request) => {
    const { tokenId } = request.params;
    const lookup = await directory.lookup(tokenId);
    if (lookup.kind === "unavailable") throw fail(503, "OWNERSHIP_UNAVAILABLE", "The chain can't be read right now; try again shortly.");
    return { tokenId, awakened: lookup.kind === "awakened", agentKey: lookup.kind === "awakened" ? makeAgentKey(lookup.identity) : null };
  });

  if (awaken) {
    app.get<{ Params: { tokenId: string } }>("/api/soul/awaken/:tokenId", { schema: { params: tokenParams } }, async (request) => {
      const { tokenId } = request.params;
      const lookup = await directory.lookup(tokenId);
      if (lookup.kind === "unavailable") throw fail(503, "OWNERSHIP_UNAVAILABLE", "The chain can't be read right now; try again shortly.");
      if (lookup.kind === "awakened") throw fail(409, "ALREADY_AWAKENED", `Chog #${tokenId} is already awake.`);
      return awakenPlan(awaken, tokenId);
    });
  }
}
