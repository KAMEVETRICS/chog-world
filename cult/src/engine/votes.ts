import type { AgentKey } from "../shared/identity.js";
import { PLACES, RULES_VERSION, decreeById, decreesFor, type FactionId, type Phase, type Place } from "../rules.js";
import { isEligible } from "./eligibility.js";
import { stableHash } from "./hash.js";
import type { MemberAtTally, Result, Traits, VoteRecord } from "./types.js";

function traitValues(traits: Traits, trait: string): string[] {
  return Object.entries(traits).filter(([type]) => type.toLowerCase() === trait).map(([, value]) => value.toLowerCase());
}

/**
 * The decree a Chog's agent supports at a place: the best trait-keyword match among its faction's decrees.
 * Equal scores break by a stable hash of the Chog and place, so tied Chogs spread across decrees.
 */
export function agentVote(traits: Traits, agentKey: AgentKey, place: Place, faction: FactionId): string {
  const options = decreesFor(faction, place);
  const scored = options.map((decree) => ({
    id: decree.id,
    score: decree.affinities.reduce((sum, affinity) => sum + (traitValues(traits, affinity.trait).some((value) => value.includes(affinity.keyword)) ? affinity.weight : 0), 0),
  }));
  const best = Math.max(...scored.map((entry) => entry.score));
  const tied = scored.filter((entry) => entry.score === best);
  return tied[stableHash(`${RULES_VERSION}|${agentKey}|${place}`) % tied.length]!.id;
}

/**
 * Agent votes cast when the Vote phase opens: one per place for each eligible member with the persona stance.
 * `choices` are a Chog's own (AI) picks; any that is not one of its faction's decrees for that place is
 * ignored and the trait rule decides instead.
 */
export function castAgentVotes(members: readonly MemberAtTally[], cycle: number, choices: ReadonlyMap<string, Partial<Record<Place, string>>> = new Map()): VoteRecord[] {
  return [...members]
    .filter((member) => member.stance === "persona" && isEligible(member, cycle))
    .sort((a, b) => (a.agentKey < b.agentKey ? -1 : a.agentKey > b.agentKey ? 1 : 0))
    .flatMap((member) => PLACES.map((place): VoteRecord => {
      const faction = member.faction!;
      const chosen = choices.get(member.agentKey)?.[place];
      const valid = chosen !== undefined && decreesFor(faction, place).some((decree) => decree.id === chosen);
      return {
        cycle, agentKey: member.agentKey, place, faction,
        decreeId: valid ? chosen : agentVote(member.traits, member.agentKey, place, faction),
        source: "agent", ownershipEpoch: member.ownershipEpoch,
      };
    }));
}

/** A holder's override (or abstention, with `decreeId` null) for one place. Only during the Vote phase. */
export function holderOverride(member: MemberAtTally, cycle: number, phase: Phase, place: Place, decreeId: string | null): Result<VoteRecord> {
  if (phase !== "vote") return { ok: false, code: "VOTING_CLOSED", message: "Votes can only be changed during the Vote phase." };
  if (!isEligible(member, cycle)) return { ok: false, code: "NOT_ELIGIBLE", message: "This Chog cannot vote in this cycle." };
  const faction = member.faction!;
  if (decreeId !== null) {
    const decree = decreeById(decreeId);
    if (!decree || decree.faction !== faction || decree.place !== place) {
      return { ok: false, code: "INVALID_INPUT", message: `${decreeId} is not a ${faction} decree for the ${place}.` };
    }
  }
  return { ok: true, value: { cycle, agentKey: member.agentKey, place, faction, decreeId, source: "holder", ownershipEpoch: member.ownershipEpoch } };
}
