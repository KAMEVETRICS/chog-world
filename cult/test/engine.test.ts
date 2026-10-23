import { describe, expect, it } from "vitest";
import { DECREES, PLACES, RULES_VERSION, decreesFor } from "../src/rules.js";
import { agentVote, castAgentVotes, holderOverride } from "../src/engine/votes.js";
import { applyTransfer, changeMembership, newMember } from "../src/engine/membership.js";
import { resolveCycle } from "../src/engine/resolveCycle.js";
import { cycleClock } from "../src/engine/clock.js";
import { TIMING } from "../src/rules.js";
import type { CycleInput, PresenceRecord } from "../src/engine/types.js";
import { PLAIN, agent, member, noControl, vote } from "./fixtures.js";

function input(overrides: Partial<CycleInput>): CycleInput {
  return { rulesVersion: RULES_VERSION, cycle: 1, members: [], votes: [], presence: [], control: noControl(), reputation: {}, ...overrides };
}

describe("decree catalog", () => {
  it("gives each faction exactly three unique decrees per place", () => {
    expect(new Set(DECREES.map((decree) => decree.id)).size).toBe(DECREES.length);
    for (const place of PLACES) {
      expect(decreesFor("crown", place)).toHaveLength(3);
      expect(decreesFor("chaos", place)).toHaveLength(3);
    }
  });
});

describe("agent persona votes", () => {
  it("picks the decree whose trait keywords best match, case-insensitively", () => {
    const king = { ...PLAIN, Head: "Crown", Body: "Kings Robe" };
    expect(agentVote(king, agent(1), "plaza", "crown")).toBe("crown-parade");
    const laser = { ...PLAIN, Eyes: "Green laser" };
    expect(agentVote(laser, agent(1), "workshop", "chaos")).toBe("laser-tinkering");
    expect(agentVote({ ...PLAIN, mouth: "BUBBLEGUM" }, agent(1), "tavern", "chaos")).toBe("bubblegum-brawl");
  });

  it("breaks ties deterministically per Chog and spreads tied Chogs across decrees", () => {
    const first = agentVote(PLAIN, agent(7), "plaza", "crown");
    expect(agentVote(PLAIN, agent(7), "plaza", "crown")).toBe(first);
    const picks = new Set(Array.from({ length: 40 }, (_, index) => agentVote(PLAIN, agent(index), "plaza", "crown")));
    expect(picks.size).toBe(3);
    for (const pick of picks) expect(decreesFor("crown", "plaza").map((decree) => decree.id)).toContain(pick);
  });

  it("casts one vote per place only for eligible, verified members with the persona stance", () => {
    const members = [
      member(1, "crown"),
      member(2, "chaos", { stance: "abstain" }),
      member(3, "crown", { joinedCycle: 1 }),
      member(4, "chaos", { control: "unavailable" }),
      member(5, null),
    ];
    const votes = castAgentVotes(members, 1);
    expect(votes.map((record) => [record.agentKey, record.place])).toEqual(PLACES.map((place) => [agent(1), place]));
    expect(votes.every((record) => record.source === "agent" && record.ownershipEpoch === "1" && record.cycle === 1)).toBe(true);
  });
});

describe("holder overrides", () => {
  const crown = member(1, "crown");
  it("records an override or abstention only during the Vote phase", () => {
    const override = holderOverride(crown, 1, "vote", "plaza", "golden-lanterns");
    expect(override).toEqual({ ok: true, value: expect.objectContaining({ source: "holder", decreeId: "golden-lanterns", ownershipEpoch: "1" }) });
    expect(holderOverride(crown, 1, "vote", "plaza", null)).toMatchObject({ ok: true, value: { decreeId: null } });
    for (const phase of ["propose", "debate", "resolve"] as const) {
      expect(holderOverride(crown, 1, phase, "plaza", "golden-lanterns")).toMatchObject({ ok: false, code: "VOTING_CLOSED" });
    }
  });

  it("rejects another faction's decree, the wrong place, and ineligible Chogs", () => {
    expect(holderOverride(crown, 1, "vote", "plaza", "bell-riot")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(holderOverride(crown, 1, "vote", "tavern", "golden-lanterns")).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(holderOverride(member(2, "crown", { joinedCycle: 1 }), 1, "vote", "plaza", "golden-lanterns")).toMatchObject({ ok: false, code: "NOT_ELIGIBLE" });
    expect(holderOverride(member(3, null), 1, "vote", "plaza", null)).toMatchObject({ ok: false, code: "NOT_ELIGIBLE" });
  });
});

describe("membership", () => {
  it("lets a new Chog join at once but only vote from the next cycle", () => {
    const joined = changeMembership(newMember(agent(1), PLAIN, "1"), { faction: "crown" }, 5);
    expect(joined).toMatchObject({ ok: true, value: { faction: "crown", stance: "persona", joinedCycle: 5, lastSwitchCycle: 5 } });
    if (!joined.ok) return;
    expect(castAgentVotes([{ ...joined.value, control: "verified" }], 5)).toEqual([]);
    expect(castAgentVotes([{ ...joined.value, control: "verified" }], 6)).toHaveLength(3);
  });

  it("enforces two full cycles between faction changes, including leaving", () => {
    const start = changeMembership(newMember(agent(1), PLAIN, "1"), { faction: "crown" }, 5);
    if (!start.ok) throw new Error("join failed");
    for (const cycle of [5, 6, 7]) {
      expect(changeMembership(start.value, { faction: "chaos" }, cycle)).toMatchObject({ ok: false, code: "SWITCH_COOLDOWN" });
      expect(changeMembership(start.value, { faction: null }, cycle)).toMatchObject({ ok: false, code: "SWITCH_COOLDOWN" });
    }
    const switched = changeMembership(start.value, { faction: "chaos" }, 8);
    expect(switched).toMatchObject({ ok: true, value: { faction: "chaos", joinedCycle: 8 } });
    if (!switched.ok) return;
    expect(switched.value.history).toEqual([{ faction: "crown", fromCycle: 5, toCycle: 8 }, { faction: "chaos", fromCycle: 8, toCycle: null }]);
  });

  it("treats re-selecting the same faction as a no-op and changes stance freely", () => {
    const start = changeMembership(newMember(agent(1), PLAIN, "1"), { faction: "crown" }, 5);
    if (!start.ok) throw new Error("join failed");
    expect(changeMembership(start.value, { faction: "crown" }, 6)).toEqual({ ok: true, value: start.value });
    expect(changeMembership(start.value, { stance: "abstain" }, 6)).toMatchObject({ ok: true, value: { stance: "abstain", lastSwitchCycle: 5 } });
    expect(changeMembership(newMember(agent(2), PLAIN, "1"), { stance: "persona" }, 6)).toMatchObject({ ok: false, code: "NOT_ELIGIBLE" });
  });

  it("resets membership on transfer but keeps public history, and the buyer has no cooldown", () => {
    const start = changeMembership(newMember(agent(1), PLAIN, "1"), { faction: "chaos" }, 2);
    if (!start.ok) throw new Error("join failed");
    const sold = applyTransfer(start.value, "2", 4);
    expect(sold).toMatchObject({ faction: null, stance: "abstain", joinedCycle: null, lastSwitchCycle: null, ownershipEpoch: "2" });
    expect(sold.history).toEqual([{ faction: "chaos", fromCycle: 2, toCycle: 4 }]);
    expect(changeMembership(sold, { faction: "crown" }, 4)).toMatchObject({ ok: true, value: { faction: "crown", joinedCycle: 4 } });
  });
});

describe("cycle resolution", () => {
  it("awards the place to the faction with more influence and enacts its most-voted decree", () => {
    const crown = [member(1, "crown"), member(2, "crown"), member(3, "crown")];
    const chaos = [member(4, "chaos"), member(5, "chaos")];
    const result = resolveCycle(input({
      members: [...crown, ...chaos],
      votes: [
        vote(crown[0]!, "plaza", "golden-lanterns"), vote(crown[1]!, "plaza", "golden-lanterns"), vote(crown[2]!, "plaza", "crown-parade"),
        vote(chaos[0]!, "plaza", "bell-riot"), vote(chaos[1]!, "plaza", "bell-riot"),
      ],
    }));
    const plaza = result.places.plaza;
    expect(plaza.influence).toEqual({ crown: { votes: 3, presence: 0, total: 9 }, chaos: { votes: 2, presence: 0, total: 6 } });
    expect(plaza).toMatchObject({ outcome: "won", control: { faction: "crown", decreeId: "golden-lanterns", sinceCycle: 2 } });
    expect(plaza.decreeVotes).toEqual({ "crown-parade": 1, "golden-lanterns": 2, "bell-riot": 2 });
    expect(result.places.tavern).toMatchObject({ outcome: "no_contest", control: null });
  });

  it("lets presence decide between voting factions but never wins a place on presence alone", () => {
    const crown = member(1, "crown");
    const chaos = member(2, "chaos");
    const presence: PresenceRecord[] = [
      { cycle: 1, agentKey: chaos.agentKey, place: "plaza", points: 4, cityRevision: "10" },
      { cycle: 1, agentKey: chaos.agentKey, place: "tavern", points: 5, cityRevision: "11" },
    ];
    const result = resolveCycle(input({ members: [crown, chaos], votes: [vote(crown, "plaza", "crown-parade"), vote(chaos, "plaza", "mask-market"), vote(crown, "tavern", "royal-toast")], presence }));
    expect(result.places.plaza).toMatchObject({ outcome: "won", control: { faction: "chaos", decreeId: "mask-market" } });
    expect(result.places.tavern.influence.chaos).toEqual({ votes: 0, presence: 5, total: 5 });
    expect(result.places.tavern).toMatchObject({ outcome: "won", control: { faction: "crown" } });
  });

  it("caps presence per Chog and place, ignores repeated City revisions and non-members", () => {
    const chaos = member(2, "chaos");
    const outsider = member(9, null);
    const presence: PresenceRecord[] = [
      { cycle: 1, agentKey: chaos.agentKey, place: "plaza", points: 3, cityRevision: "10" },
      { cycle: 1, agentKey: chaos.agentKey, place: "plaza", points: 3, cityRevision: "10" },
      { cycle: 1, agentKey: chaos.agentKey, place: "plaza", points: 4, cityRevision: "12" },
      { cycle: 0, agentKey: chaos.agentKey, place: "plaza", points: 4, cityRevision: "2" },
      { cycle: 1, agentKey: outsider.agentKey, place: "plaza", points: 4, cityRevision: "13" },
    ];
    const result = resolveCycle(input({ members: [chaos, outsider], votes: [vote(chaos, "plaza", "bell-riot")], presence }));
    expect(result.places.plaza.influence.chaos).toEqual({ votes: 1, presence: 5, total: 8 });
  });

  it("keeps the ruler on a tie, stays neutral on a tie without a ruler, and keeps control without a contest", () => {
    const crown = member(1, "crown");
    const chaos = member(2, "chaos");
    const tied = [vote(crown, "plaza", "crown-parade"), vote(chaos, "plaza", "bell-riot")];
    const ruled = { ...noControl(), plaza: { faction: "chaos" as const, decreeId: "mask-market", sinceCycle: 0 }, tavern: { faction: "crown" as const, decreeId: "royal-toast", sinceCycle: 0 } };
    const withRuler = resolveCycle(input({ members: [crown, chaos], votes: tied, control: ruled }));
    expect(withRuler.places.plaza).toMatchObject({ outcome: "tie_held", control: ruled.plaza });
    expect(withRuler.places.tavern).toMatchObject({ outcome: "no_contest", control: ruled.tavern });
    expect(resolveCycle(input({ members: [crown, chaos], votes: tied })).places.plaza).toMatchObject({ outcome: "tie_neutral", control: null });
  });

  it("keeps the ruler's start cycle when it wins again and updates its decree", () => {
    const crown = member(1, "crown");
    const control = { ...noControl(), plaza: { faction: "crown" as const, decreeId: "crown-parade", sinceCycle: 0 } };
    const result = resolveCycle(input({ members: [crown], votes: [vote(crown, "plaza", "hour-of-silence")], control }));
    expect(result.places.plaza.control).toEqual({ faction: "crown", decreeId: "hour-of-silence", sinceCycle: 0 });
  });

  it("uses a holder override over the agent vote, and a holder abstention removes the vote", () => {
    const a = member(1, "crown");
    const b = member(2, "crown");
    const result = resolveCycle(input({
      members: [a, b],
      votes: [
        vote(a, "plaza", "crown-parade"), vote(a, "plaza", "golden-lanterns", { source: "holder" }),
        vote(b, "plaza", "crown-parade"), vote(b, "plaza", null, { source: "holder" }),
      ],
    }));
    expect(result.countedVotes).toEqual([vote(a, "plaza", "golden-lanterns", { source: "holder" })]);
    expect(result.places.plaza.decreeVotes).toEqual({ "golden-lanterns": 1 });
  });

  it("rejects flash-joined, transferred, unverified, abstaining and mismatched votes", () => {
    const flash = member(1, "crown", { joinedCycle: 1 });
    const sold = member(2, "crown", { ownershipEpoch: "2" });
    const offline = member(3, "crown", { control: "unavailable" });
    const quiet = member(4, "crown", { stance: "abstain" });
    const switched = member(5, "chaos");
    const good = member(6, "crown");
    const votes = [
      vote(flash, "plaza", "crown-parade"),
      vote(sold, "plaza", "crown-parade", { ownershipEpoch: "1" }),
      vote(offline, "plaza", "crown-parade"),
      vote(quiet, "plaza", "crown-parade"),
      vote(switched, "plaza", "crown-parade", { faction: "crown" }),
      vote(good, "plaza", "bell-riot"),
      vote(good, "tavern", "royal-toast", { cycle: 0 }),
      vote(member(7, "crown"), "workshop", "golden-forge"),
    ];
    const result = resolveCycle(input({ members: [flash, sold, offline, quiet, switched, good], votes }));
    expect(result.countedVotes).toEqual([]);
    expect(result.rejectedVotes.map((entry) => entry.reason).sort()).toEqual(
      ["epoch_changed", "faction_mismatch", "invalid_decree", "not_eligible", "not_eligible", "stance_abstain", "unknown_member", "wrong_cycle"],
    );
  });

  it("still counts a holder override when the stance is abstain", () => {
    const quiet = member(4, "crown", { stance: "abstain" });
    const result = resolveCycle(input({ members: [quiet], votes: [vote(quiet, "plaza", "crown-parade", { source: "holder" })] }));
    expect(result.places.plaza.control?.faction).toBe("crown");
  });

  it("gives loyalty to members who voted and glory to the winning faction's eligible members", () => {
    const voter = member(1, "crown");
    const idle = member(2, "crown", { stance: "abstain" });
    const newcomer = member(3, "crown", { joinedCycle: 1 });
    const rival = member(4, "chaos");
    const result = resolveCycle(input({
      members: [voter, idle, newcomer, rival],
      votes: [vote(voter, "plaza", "crown-parade"), vote(voter, "tavern", "royal-toast"), vote(rival, "workshop", "scrap-rocket")],
      reputation: { [voter.agentKey]: { loyalty: 4, glory: 1 } },
    }));
    expect(result.reputationDeltas).toEqual({
      [voter.agentKey]: { loyalty: 1, glory: 2 },
      [idle.agentKey]: { loyalty: 0, glory: 2 },
      [rival.agentKey]: { loyalty: 1, glory: 1 },
    });
    expect(result.reputation[voter.agentKey]).toEqual({ loyalty: 5, glory: 3 });
    expect(result.reputation[newcomer.agentKey]).toBeUndefined();
  });

  it("is deterministic: the same input in any order gives an identical result", () => {
    const members = [member(1, "crown"), member(2, "chaos"), member(3, "crown")];
    const votes = castAgentVotes(members, 1);
    const presence: PresenceRecord[] = [{ cycle: 1, agentKey: members[1]!.agentKey, place: "tavern", points: 2, cityRevision: "4" }];
    const forward = resolveCycle(input({ members, votes, presence }));
    const reversed = resolveCycle(input({ members: [...members].reverse(), votes: [...votes].reverse(), presence }));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });

  it("refuses input with duplicate votes or a different rules version", () => {
    const crown = member(1, "crown");
    expect(() => resolveCycle(input({ members: [crown], votes: [vote(crown, "plaza", "crown-parade"), vote(crown, "plaza", "golden-lanterns")] }))).toThrow(/duplicate/);
    expect(() => resolveCycle(input({ rulesVersion: "cult-rules-0" }))).toThrow(/rules version/);
  });
});

describe("cycle clock", () => {
  const { phaseMs } = TIMING.demo;
  const cycleMs = phaseMs.propose + phaseMs.debate + phaseMs.vote + phaseMs.resolve;
  it("maps time since genesis to cycle, phase and the next boundary", () => {
    expect(cycleClock(1_000, 1_000, TIMING.demo)).toEqual({ cycle: 0, phase: "propose", phaseEndsAtMs: 1_000 + phaseMs.propose });
    expect(cycleClock(0, phaseMs.propose, TIMING.demo)).toMatchObject({ cycle: 0, phase: "debate" });
    expect(cycleClock(0, cycleMs - 1, TIMING.demo)).toMatchObject({ cycle: 0, phase: "resolve", phaseEndsAtMs: cycleMs });
    expect(cycleClock(0, 2 * cycleMs + phaseMs.propose + phaseMs.debate, TIMING.demo)).toMatchObject({ cycle: 2, phase: "vote" });
    expect(() => cycleClock(10, 9, TIMING.demo)).toThrow(/before genesis/);
  });
});
