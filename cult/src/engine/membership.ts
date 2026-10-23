import type { AgentKey } from "../shared/identity.js";
import { SWITCH_COOLDOWN_CYCLES, type FactionId, type Stance } from "../rules.js";
import type { FactionSpan, Member, Result, Traits } from "./types.js";

export function newMember(agentKey: AgentKey, traits: Traits, ownershipEpoch: string): Member {
  return { agentKey, faction: null, stance: "abstain", joinedCycle: null, lastSwitchCycle: null, ownershipEpoch, traits, history: [] };
}

function closeHistory(history: readonly FactionSpan[], cycle: number): FactionSpan[] {
  return history.map((span) => (span.toCycle === null ? { ...span, toCycle: cycle } : span));
}

export interface MembershipRequest {
  readonly faction?: FactionId | null;
  readonly stance?: Stance;
}

/**
 * Applies a holder's faction or stance change in `cycle`. Joining or leaving a faction is limited by the
 * switch cooldown; a newly joined Chog votes from the next cycle. Stance changes are free for members.
 */
export function changeMembership(member: Member, request: MembershipRequest, cycle: number): Result<Member> {
  let next = member;
  if (request.faction !== undefined && request.faction !== member.faction) {
    if (member.lastSwitchCycle !== null && cycle <= member.lastSwitchCycle + SWITCH_COOLDOWN_CYCLES) {
      const available = member.lastSwitchCycle + SWITCH_COOLDOWN_CYCLES + 1;
      return { ok: false, code: "SWITCH_COOLDOWN", message: `This Chog changed faction recently; it can change again in cycle ${available}.` };
    }
    const history = closeHistory(member.history, cycle);
    next = request.faction === null
      ? { ...member, faction: null, stance: "abstain", joinedCycle: null, lastSwitchCycle: cycle, history }
      : { ...member, faction: request.faction, stance: "persona", joinedCycle: cycle, lastSwitchCycle: cycle, history: [...history, { faction: request.faction, fromCycle: cycle, toCycle: null }] };
  }
  if (request.stance !== undefined && request.stance !== next.stance) {
    if (next.faction === null) return { ok: false, code: "NOT_ELIGIBLE", message: "Join a faction before setting a voting stance." };
    next = { ...next, stance: request.stance };
  }
  return { ok: true, value: next };
}

/**
 * Every NFT transfer: the new holder starts Unaligned with no cooldown, the seller's choices end, and the
 * public faction history stays. Votes recorded under the old epoch stop counting at tally.
 */
export function applyTransfer(member: Member, ownershipEpoch: string, cycle: number): Member {
  return { ...member, faction: null, stance: "abstain", joinedCycle: null, lastSwitchCycle: null, ownershipEpoch, history: closeHistory(member.history, cycle) };
}
