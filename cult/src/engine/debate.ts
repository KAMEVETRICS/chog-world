import { PLACES, decreeById, type FactionId, type Place } from "../rules.js";
import { isEligible } from "./eligibility.js";
import { stableHash } from "./hash.js";
import { agentVote } from "./votes.js";
import type { MemberAtTally } from "./types.js";

export interface DebateLine {
  readonly agentKey: string;
  readonly place: Place;
  readonly decreeId: string;
  readonly text: string;
  /** True for the rule-based template line; false when the Chog's Soul wrote it. Debate never changes votes or outcomes. */
  readonly scripted: boolean;
}

const TEMPLATES: Readonly<Record<FactionId, readonly string[]>> = {
  crown: [
    "{name} insists the {place} deserves order: \"{title}\".",
    "{name} reminds the Crown that a proper {place} needs \"{title}\".",
    "{name} raises a paw for \"{title}\" at the {place}.",
  ],
  chaos: [
    "{name} wants the {place} loud: \"{title}\"!",
    "{name} scribbles \"{title}\" on every wall near the {place}.",
    "{name} dares the Crown to stop \"{title}\" at the {place}.",
  ],
};

const PLACE_NAMES: Readonly<Record<Place, string>> = { plaza: "Plaza", tavern: "Tavern", workshop: "Workshop" };

/** One templated argument per eligible persona member, for the place and decree its agent favours. */
export function debateLines(members: readonly MemberAtTally[], cycle: number, names: Readonly<Record<string, string>>): DebateLine[] {
  return [...members]
    .filter((member) => member.stance === "persona" && isEligible(member, cycle))
    .sort((a, b) => (a.agentKey < b.agentKey ? -1 : 1))
    .map((member) => {
      const faction = member.faction!;
      const roll = stableHash(`debate|${cycle}|${member.agentKey}`);
      const place = PLACES[roll % PLACES.length]!;
      const decreeId = agentVote(member.traits, member.agentKey, place, faction);
      const templates = TEMPLATES[faction];
      const text = templates[Math.floor(roll / PLACES.length) % templates.length]!
        .replace("{name}", names[member.agentKey] ?? `Chog ${member.agentKey.split(":")[4]}`)
        .replace("{place}", PLACE_NAMES[place])
        .replace("{title}", decreeById(decreeId)!.title);
      return { agentKey: member.agentKey, place, decreeId, text, scripted: true };
    });
}
