import { FACTION_INFO, decreeById, type FactionId, type Place } from "../../src/rules";
import type { EventDto } from "./api";

export const PLACE_NAMES: Readonly<Record<Place, string>> = { plaza: "Plaza", tavern: "Tavern", workshop: "Workshop" };
export const PHASE_NAMES = { propose: "Propose", debate: "Debate", vote: "Vote", resolve: "Resolve" } as const;

export function factionName(faction: FactionId | null): string {
  return faction ? FACTION_INFO[faction].name : "Unaligned";
}

export function decreeTitle(id: string | null | undefined): string {
  if (!id) return "Abstain";
  return decreeById(id)?.title ?? id;
}

/** Plain-language line for one public event. Returns null for events not worth showing in the feed. */
export function describeEvent(event: EventDto, names: ReadonlyMap<string, string>): { text: string; tone: "normal" | "scripted" | "ai" | "warning" | "result" } | null {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const name = (key: unknown) => names.get(String(key)) ?? "A Chog";
  switch (event.type) {
    case "phase_changed": return { text: `Cycle ${event.cycle}: ${PHASE_NAMES[payload.phase as keyof typeof PHASE_NAMES] ?? payload.phase} phase begins.`, tone: "normal" };
    case "debate": return { text: String(payload.text ?? ""), tone: payload.scripted === false ? "ai" : "scripted" };
    case "votes_cast": return { text: `Agents cast ${payload.votes} votes.`, tone: "normal" };
    case "override": return { text: `${name(payload.agentKey)}'s holder chose ${decreeTitle(payload.decreeId as string | null)} for the ${PLACE_NAMES[payload.place as Place]}.`, tone: "normal" };
    case "member_changed": return { text: payload.faction ? `${name(payload.agentKey)} now stands with ${factionName(payload.faction as FactionId)}${payload.stance === "abstain" ? " (abstaining)" : ""}.` : `${name(payload.agentKey)} is now Unaligned.`, tone: "normal" };
    case "control_changed":
      return payload.status === "unavailable"
        ? { text: `Ownership of ${name(payload.agentKey)} can't be checked right now; it sits out until it can.`, tone: "warning" }
        : { text: `${name(payload.agentKey)}: ownership updated (epoch ${payload.ownershipEpoch}).`, tone: "normal" };
    case "city_gap": return { text: "Chog City was unreachable, so presence counts zero this cycle.", tone: "warning" };
    case "city_late": return { text: `Ignored ${payload.ignored} City ticks from an earlier cycle.`, tone: "warning" };
    case "schedule_gap": return { text: "The council was offline for a while; skipped time was not simulated.", tone: "warning" };
    case "place_control_changed": {
      const control = payload.control as { faction: FactionId; decreeId: string } | null;
      const place = PLACE_NAMES[payload.place as Place];
      return control
        ? { text: `${factionName(control.faction)} takes the ${place}: ${decreeById(control.decreeId)?.feedLine ?? decreeTitle(control.decreeId)}`, tone: "result" }
        : { text: `The ${place} is now neutral.`, tone: "result" };
    }
    case "cycle_resolved": return { text: `Cycle ${payload.cycle} resolved.`, tone: "result" };
    default: return null;
  }
}
