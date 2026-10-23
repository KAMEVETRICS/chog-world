// The Chogs admitted to the live Cult. Until City publishes its resident list, a server-owned JSON file
// lists them. Contracts never come from the roster: every identity is built from the verified manifest.
import { makeAgentKey, type AgentIdentity } from "../shared/identity.js";
import type { CouncilChog } from "../council/memoryCouncil.js";
import type { LiveDeployment } from "../chain/liveChainReader.js";

const UINT = /^(0|[1-9][0-9]{0,77})$/;

export function parseRoster(json: unknown, deployment: LiveDeployment): CouncilChog[] {
  const entries = (json as { chogs?: unknown } | null)?.chogs;
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('The roster must be {"chogs": [...]} with at least one Chog.');
  const seen = { name: new Set<string>(), tokenId: new Set<string>(), agentId: new Set<string>() };
  return entries.map((entry: unknown, index): CouncilChog => {
    const { name, tokenId, agentId, traits } = (entry ?? {}) as Record<string, unknown>;
    const at = `Roster entry ${index}`;
    if (typeof name !== "string" || !/^\S(.{0,38}\S)?$/.test(name)) throw new Error(`${at}: name must be 1–40 characters.`);
    if (typeof tokenId !== "string" || !UINT.test(tokenId)) throw new Error(`${at}: tokenId must be a decimal string.`);
    if (typeof agentId !== "string" || !UINT.test(agentId)) throw new Error(`${at}: agentId must be a decimal string.`);
    if (typeof traits !== "object" || traits === null || Array.isArray(traits) || !Object.values(traits).every((value) => typeof value === "string")) {
      throw new Error(`${at}: traits must be an object of strings.`);
    }
    // One admitted Chog per token, as in City: no duplicate grants through repeated entries.
    for (const [key, value] of [["name", name], ["tokenId", tokenId], ["agentId", agentId]] as const) {
      if (seen[key].has(value)) throw new Error(`${at}: duplicate ${key} ${value}.`);
      seen[key].add(value);
    }
    const identity: AgentIdentity = {
      chainId: deployment.chainId, registry: deployment.registry, adapter: deployment.adapter, collection: deployment.collection, tokenId, agentId,
    };
    return { name, identity, agentKey: makeAgentKey(identity), traits: traits as Record<string, string> };
  });
}
