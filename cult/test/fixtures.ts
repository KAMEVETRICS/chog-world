import { makeAgentKey, type AgentKey } from "../src/shared/identity.js";
import { PLACES, type FactionId, type Place } from "../src/rules.js";
import type { MemberAtTally, PlaceControl, Traits, VoteRecord } from "../src/engine/types.js";

export function agent(tokenId: number): AgentKey {
  return makeAgentKey({
    chainId: 31337,
    registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    adapter: "0x095FFc29B9b7384763aac703a627Bf8A2D6c7869",
    collection: "0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763",
    tokenId: String(tokenId),
    agentId: String(tokenId + 1000),
  });
}

export const PLAIN: Traits = { Background: "Mint", Skin: "Origin", Body: "Plain", Mouth: "Flat", Eyes: "Round Eye", Head: "Bob Hair", Aura: "Clean" };

/** A member of `faction` who joined in cycle 0, so it is eligible from cycle 1. */
export function member(tokenId: number, faction: FactionId | null, overrides: Partial<MemberAtTally> = {}): MemberAtTally {
  return {
    agentKey: agent(tokenId),
    faction,
    stance: faction ? "persona" : "abstain",
    joinedCycle: faction ? 0 : null,
    lastSwitchCycle: faction ? 0 : null,
    ownershipEpoch: "1",
    traits: PLAIN,
    history: faction ? [{ faction, fromCycle: 0, toCycle: null }] : [],
    control: "verified",
    ...overrides,
  };
}

export function vote(m: MemberAtTally, place: Place, decreeId: string | null, overrides: Partial<VoteRecord> = {}): VoteRecord {
  if (!m.faction) throw new Error("fixture vote needs a faction member");
  return { cycle: 1, agentKey: m.agentKey, place, faction: m.faction, decreeId, source: "agent", ownershipEpoch: m.ownershipEpoch, ...overrides };
}

export function noControl(): Record<Place, PlaceControl | null> {
  return Object.fromEntries(PLACES.map((place) => [place, null])) as Record<Place, PlaceControl | null>;
}
