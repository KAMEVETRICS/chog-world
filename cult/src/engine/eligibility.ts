import type { MemberAtTally } from "./types.js";

/** A Chog takes part in cycle `cycle` only if it joined a faction in an earlier cycle and its control is verified. */
export function isEligible(member: MemberAtTally, cycle: number): boolean {
  return member.faction !== null && member.joinedCycle !== null && member.joinedCycle < cycle && member.control === "verified";
}
