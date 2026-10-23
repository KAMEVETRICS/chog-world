import { DECREES, FACTIONS, PLACES, PRESENCE_CAP_PER_AGENT, PRESENCE_WEIGHT, RULES_VERSION, VOTE_WEIGHT, decreeById, type FactionId, type Place } from "../rules.js";
import { isEligible } from "./eligibility.js";
import type { CycleInput, CycleResult, FactionInfluence, MemberAtTally, PlaceControl, PlaceResult, RejectReason, Reputation, VoteRecord } from "./types.js";

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const placeIndex = (place: Place) => PLACES.indexOf(place);
const voteOrder = (a: VoteRecord, b: VoteRecord) => byKey(a.agentKey, b.agentKey) || placeIndex(a.place) - placeIndex(b.place) || byKey(a.source, b.source);

function rejection(vote: VoteRecord, member: MemberAtTally | undefined, cycle: number): RejectReason | null {
  if (vote.cycle !== cycle) return "wrong_cycle";
  if (!member) return "unknown_member";
  if (!isEligible(member, cycle)) return "not_eligible";
  if (member.faction !== vote.faction) return "faction_mismatch";
  if (member.ownershipEpoch !== vote.ownershipEpoch) return "epoch_changed";
  if (vote.source === "agent" && member.stance !== "persona") return "stance_abstain";
  if (vote.decreeId !== null) {
    const decree = decreeById(vote.decreeId);
    if (!decree || decree.faction !== vote.faction || decree.place !== vote.place) return "invalid_decree";
  }
  return null;
}

/**
 * Resolves one council cycle. Pure and deterministic: the result depends only on the input, never on its
 * ordering, the clock or randomness. A holder record for a place supersedes the agent record for it.
 */
export function resolveCycle(input: CycleInput): CycleResult {
  if (input.rulesVersion !== RULES_VERSION) throw new Error(`Input uses rules version ${input.rulesVersion}; this engine implements ${RULES_VERSION}.`);
  const { cycle } = input;
  const members = new Map(input.members.map((member) => [member.agentKey as string, member]));

  const seen = new Set<string>();
  for (const vote of input.votes) {
    const key = `${vote.cycle}|${vote.agentKey}|${vote.place}|${vote.source}`;
    if (seen.has(key)) throw new Error(`Input has a duplicate ${vote.source} vote for ${vote.agentKey} at the ${vote.place}.`);
    seen.add(key);
  }

  // Holder records (overrides and abstentions) replace the agent's record for the same place.
  const holderPlaces = new Set(input.votes.filter((vote) => vote.source === "holder" && vote.cycle === cycle).map((vote) => `${vote.agentKey}|${vote.place}`));
  const counted: VoteRecord[] = [];
  const rejected: { vote: VoteRecord; reason: RejectReason }[] = [];
  for (const vote of [...input.votes].sort(voteOrder)) {
    if (vote.source === "agent" && vote.cycle === cycle && holderPlaces.has(`${vote.agentKey}|${vote.place}`)) continue;
    const reason = rejection(vote, members.get(vote.agentKey), cycle);
    if (reason) rejected.push({ vote, reason });
    else if (vote.decreeId !== null) counted.push(vote);
  }

  // Presence: once per City revision, eligible members only, capped per Chog and place.
  const presence = new Map<string, number>();
  const revisions = new Set<string>();
  const sortedPresence = [...input.presence].sort((a, b) => byKey(a.cityRevision, b.cityRevision) || byKey(a.agentKey, b.agentKey) || placeIndex(a.place) - placeIndex(b.place) || a.points - b.points);
  for (const record of sortedPresence) {
    const member = members.get(record.agentKey);
    const revisionKey = `${record.cityRevision}|${record.agentKey}|${record.place}`;
    if (record.cycle !== cycle || !member || !isEligible(member, cycle) || revisions.has(revisionKey)) continue;
    revisions.add(revisionKey);
    const key = `${record.agentKey}|${record.place}`;
    presence.set(key, Math.min(PRESENCE_CAP_PER_AGENT, (presence.get(key) ?? 0) + Math.max(0, Math.trunc(record.points))));
  }

  const places = {} as Record<Place, PlaceResult>;
  const winners: { place: Place; faction: FactionId }[] = [];
  for (const place of PLACES) {
    const influence = {} as Record<FactionId, FactionInfluence>;
    for (const faction of FACTIONS) {
      const votes = counted.filter((vote) => vote.place === place && vote.faction === faction).length;
      let presencePoints = 0;
      for (const member of members.values()) {
        if (member.faction === faction && isEligible(member, cycle)) presencePoints += presence.get(`${member.agentKey}|${place}`) ?? 0;
      }
      influence[faction] = { votes, presence: presencePoints, total: VOTE_WEIGHT * votes + PRESENCE_WEIGHT * presencePoints };
    }
    const decreeVotes: Record<string, number> = {};
    for (const decree of DECREES) {
      const count = counted.filter((vote) => vote.decreeId === decree.id).length;
      if (decree.place === place && count > 0) decreeVotes[decree.id] = count;
    }

    const current = input.control[place];
    const contenders = FACTIONS.filter((faction) => influence[faction].votes > 0);
    let outcome: PlaceResult["outcome"];
    let control: PlaceControl | null = current;
    let winner: FactionId | null = null;
    if (contenders.length === 0) outcome = "no_contest";
    else {
      const top = Math.max(...contenders.map((faction) => influence[faction].total));
      const leaders = contenders.filter((faction) => influence[faction].total === top);
      if (leaders.length === 1) { outcome = "won"; winner = leaders[0]!; }
      else if (current) outcome = "tie_held";
      else { outcome = "tie_neutral"; control = null; }
    }
    if (winner) {
      // The winner's decree with the most counted votes; ties go to catalog order.
      const options = DECREES.filter((decree) => decree.place === place && decree.faction === winner);
      const decree = options.reduce((best, option) => ((decreeVotes[option.id] ?? 0) > (decreeVotes[best.id] ?? 0) ? option : best), options[0]!);
      control = { faction: winner, decreeId: decree.id, sinceCycle: current?.faction === winner ? current.sinceCycle : cycle + 1 };
      winners.push({ place, faction: winner });
    }
    places[place] = { influence, decreeVotes, outcome, control };
  }

  const deltas = new Map<string, { loyalty: number; glory: number }>();
  const bump = (agentKey: string, field: "loyalty" | "glory") => {
    const delta = deltas.get(agentKey) ?? { loyalty: 0, glory: 0 };
    delta[field] += 1;
    deltas.set(agentKey, delta);
  };
  for (const agentKey of new Set(counted.map((vote) => vote.agentKey))) bump(agentKey, "loyalty");
  for (const { faction } of winners) {
    for (const member of members.values()) if (member.faction === faction && isEligible(member, cycle)) bump(member.agentKey, "glory");
  }
  const reputationDeltas: Record<string, Reputation> = {};
  for (const key of [...deltas.keys()].sort(byKey)) reputationDeltas[key] = deltas.get(key)!;
  const reputation: Record<string, Reputation> = {};
  for (const key of [...new Set([...Object.keys(input.reputation), ...deltas.keys()])].sort(byKey)) {
    const base = input.reputation[key] ?? { loyalty: 0, glory: 0 };
    const delta = deltas.get(key) ?? { loyalty: 0, glory: 0 };
    reputation[key] = { loyalty: base.loyalty + delta.loyalty, glory: base.glory + delta.glory };
  }

  return { rulesVersion: RULES_VERSION, cycle, places, countedVotes: counted, rejectedVotes: rejected, reputation, reputationDeltas };
}
