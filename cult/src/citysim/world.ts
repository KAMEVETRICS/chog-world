// The one place this server imports Chog City's own code. The City team owns ../city: its contracts, every
// game number (rules.ts), the pure simulation and the village layout. This server only stores and schedules it.
import worldFile from "../../../city/src/fixtures/world.json";
import { GENESIS_SUPPLY, genesisLook } from "../../../city/src/fixtures/chog-genesis";
import type { ControlObservation as CultObservation, AgentIdentity as CultIdentity } from "../shared/identity.js";
import type { AgentIdentity, ControlObservation, Lot, Place, PlaceId, Plot } from "../../../city/src/shared/contracts";
export { defaultParams } from "../../../city/src/shared/constitution";

export { applyControlChange, applyPolicyChange, hashJson, hashWorld, step } from "../../../city/src/simulation/step";
export { line as ledgerLine } from "../../../city/src/simulation/resources";
export { applyDecor } from "../../../city/src/simulation/needs";
export { applyAction, applyCouncilTurn, emptyProjects } from "../../../city/src/simulation/economy";
export { councilDue, councilMembers, councilPrompt, parseCouncilReply, rulesCouncilTurn, runCouncilSession, type CouncilSeat } from "../../../city/src/simulation/council";
export { accountEntry, admitCitizen, applyJobChange, citizenKeyOf, reconcileAccounts } from "../../../city/src/simulation/citizens";
export { cityActionSchema, instructionsRequestSchema, jobRequestSchema, joinRequestSchema } from "../../../city/src/shared/schemas";
export { ADMISSION_GRANT, DEFAULT_HOME_STYLE, GENESIS_TREASURY_COINS, PROJECTS, MAX_CATCH_UP_TICKS, NEED_START, RULESET_VERSION, TICK_MS } from "../../../city/src/shared/rules";
export { DECOR_IDS, FOCUSES, HOME_STYLES, PLACE_IDS, RESOURCES, makeAgentKey as makeCityAgentKey } from "../../../city/src/shared/contracts";
export { policyUpdateRequestSchema } from "../../../city/src/shared/schemas";
export type {
  AccountEntry, CitizenState, CityAction, CouncilTurn, JobRequest, JoinRequest, ParamState, ProjectState, Treasury,
  AgentIdentity as CityIdentity, AgentState, CityEvent, DecorId, CityEventType, CitySnapshot, ControlObservation as CityObservation, Focus, HomeStyle,
  LedgerEntry, Location, Place, PlaceId, Plot, Policy, PolicyUpdateRequest, PublicChange, Resource, TickActivity, WorldState,
} from "../../../city/src/shared/contracts";

/** The village layout from City's world file. Plot IDs and order never change: admission takes the first free plot. */
export const CITY_PLACES: readonly Place[] = worldFile.places as Place[];
export const CITY_PLOTS: readonly Plot[] = worldFile.plots;
/** The citizens' district (Newcomers' Row). */
export const CITY_LOTS: readonly Lot[] = worldFile.lots;
export const FIXTURE_CITY_ID = worldFile.cityId;

/**
 * A Chog Genesis token's traits, from City's table of all 1,969 tokens read from the collection (token N's
 * metadata is not N.json, so it is looked up by token ID). Empty for a token outside the collection.
 */
export function genesisTraits(tokenId: string): Record<string, string> {
  const traits: Record<string, string> = {};
  for (const [name, value] of Object.entries(genesisLook(tokenId)?.traits ?? {})) if (typeof value === "string") traits[name] = value;
  return traits;
}

/** Chog Genesis token IDs run from 1 to this (the collection's full mint). */
export const GENESIS_MAX_TOKEN_ID = GENESIS_SUPPLY;

/** The token's artwork through an IPFS gateway, for pages; null for a token outside the collection. */
export function genesisImageUrl(tokenId: string): string | null {
  return genesisLook(tokenId)?.image ?? null;
}

/** The same artwork as a gateway-independent ipfs:// URI, for records that should outlive any web server. */
export function genesisImageIpfs(tokenId: string): string | null {
  const url = genesisImageUrl(tokenId);
  const match = url?.match(/\/ipfs\/(.+)$/);
  return match ? `ipfs://${match[1]}` : null;
}

export function placeName(id: PlaceId): string {
  return CITY_PLACES.find((place) => place.id === id)?.name ?? id;
}

/** City writes chain IDs as decimal strings and addresses in any case; the agent key comes out the same. */
export function cityIdentity(identity: CultIdentity): AgentIdentity {
  return {
    chainId: String(identity.chainId), registry: identity.registry.toLowerCase(), adapter: identity.adapter.toLowerCase(),
    collection: identity.collection.toLowerCase(), tokenId: identity.tokenId, agentId: identity.agentId,
  };
}

/** Back to this server's identity, for ownership reads. */
export function cultIdentity(identity: AgentIdentity): CultIdentity {
  const chainId = Number(identity.chainId);
  if (chainId !== 31337 && chainId !== 10143 && chainId !== 143) throw new Error(`Unsupported chain ${identity.chainId}.`);
  return { ...identity, chainId };
}

/**
 * This server's ownership reading in City's terms. A Chog that is not (or no longer) awakened under the
 * manifest's adapter is `unbound`; an outage stays `unavailable`, which freezes the resident and never
 * counts as a transfer or burn.
 */
export function cityObservation(observation: CultObservation, nowMs: number): ControlObservation {
  if (observation.kind === "unavailable") return { status: "unavailable", reason: observation.reason, observedAtMs: nowMs };
  const evidence = {
    epoch: observation.ownershipEpoch, projectionGeneration: observation.projectionGeneration,
    blockNumber: observation.blockNumber, blockHash: observation.blockHash, observedAtMs: observation.observedAtMs,
  };
  if (observation.kind === "controlled") return { status: "controlled", controller: observation.controller.toLowerCase(), ...evidence };
  return { status: observation.kind === "burned" ? "burned" : "unbound", controller: null, ...evidence };
}
