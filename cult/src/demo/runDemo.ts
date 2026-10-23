import { FACTIONS, PHASES, PLACES, TIMING, decreeById, type FactionId, type Phase } from "../rules.js";
import { MemoryCouncil, type CouncilEvent } from "../council/memoryCouncil.js";
import { FakeCityFeed } from "../fixture/cityFeed.js";
import { FixtureChainReader } from "../fixture/chainReader.js";
import { FIXTURE_CHOGS, FIXTURE_HOLDERS, chogByName, type HolderName } from "../fixture/chogs.js";
import type { Result } from "../engine/types.js";

export const DEMO_CYCLES = 6;
const CITY_TICKS_PER_PHASE = 6;

type Step = (demo: DemoContext) => Promise<void>;
interface DemoContext {
  council: MemoryCouncil;
  reader: FixtureChainReader;
  feed: FakeCityFeed;
  say: (line: string) => void;
}

const holder = (name: HolderName) => FIXTURE_HOLDERS[name];
const key = (name: string) => chogByName(name).agentKey;

function report(say: (line: string) => void, label: string, result: Result<unknown>): void {
  say(result.ok ? `  ✓ ${label}` : `  ✗ ${label}: ${result.code} (${result.message})`);
}

/** The scripted story, keyed by cycle and the phase in which each step runs. */
const SCRIPT: Readonly<Record<number, Partial<Record<Phase, Step>>>> = {
  0: {
    propose: async ({ council, say }) => {
      say("Holders choose sides:");
      const joins: [HolderName, string, FactionId][] = [
        ["alice", "Regent", "crown"], ["bob", "Banker", "crown"], ["carol", "Butler", "crown"],
        ["dave", "Ember", "chaos"], ["erin", "Glitch", "chaos"], ["frank", "Jester", "chaos"],
      ];
      for (const [who, chog, faction] of joins) report(say, `${who} puts ${chog} in ${faction}`, await council.setMembership(holder(who), key(chog), { faction }));
      say("  Gina's Drifter and Hank's Pilot stay Unaligned. New members vote from cycle 1.");
    },
  },
  2: {
    vote: async ({ council, say }) => {
      report(say, "alice overrides Regent's Plaza vote to Golden Lanterns", await council.override(holder("alice"), key("Regent"), "plaza", "golden-lanterns"));
      report(say, "erin sets Glitch to abstain", await council.setMembership(holder("erin"), key("Glitch"), { stance: "abstain" }));
      report(say, "gina joins Drifter to chaos mid-vote (counts from cycle 3)", await council.setMembership(holder("gina"), key("Drifter"), { faction: "chaos" }));
      report(say, "bob tries to switch Banker to chaos", await council.setMembership(holder("bob"), key("Banker"), { faction: "chaos" }));
    },
  },
  3: {
    vote: async ({ council, reader, say }) => {
      reader.transfer(chogByName("Butler").identity, holder("hank"));
      say("  ⇄ carol sells Butler to hank during the vote");
      report(say, "carol tries to override Butler's Tavern vote", await council.override(holder("carol"), key("Butler"), "tavern", "noble-supper"));
      report(say, "hank, the new holder, puts Butler in chaos (counts from cycle 4)", await council.setMembership(holder("hank"), key("Butler"), { faction: "chaos" }));
      report(say, "erin sets Glitch back to persona", await council.setMembership(holder("erin"), key("Glitch"), { stance: "persona" }));
    },
  },
  4: {
    debate: async ({ feed, reader, say }) => {
      feed.setDown(true);
      reader.setUnavailable(chogByName("Glitch").identity, true);
      say("  ⚠ Chog City's feed goes down, and ownership reads for Glitch fail");
    },
  },
  5: {
    propose: async ({ council, feed, reader, say }) => {
      feed.setDown(false);
      reader.setUnavailable(chogByName("Glitch").identity, false);
      say("  City and ownership reads are back");
      report(say, "bob switches Banker to chaos (cooldown over)", await council.setMembership(holder("bob"), key("Banker"), { faction: "chaos" }));
    },
  },
};

function describeEvent(event: CouncilEvent, names: Readonly<Record<string, string>>): string | null {
  const name = (agentKey: string) => names[agentKey] ?? agentKey;
  switch (event.type) {
    case "debate": return `  💬 [Scripted] ${event.line.text}`;
    case "votes_cast": return `  🗳 Agents cast ${event.votes} votes`;
    case "control_changed": return `  🔑 ${name(event.agentKey)}: control ${event.status} (ownership epoch ${event.ownershipEpoch})`;
    case "city_gap": return `  ⚠ No City presence this cycle: ${event.reason}`;
    case "city_late": return `  ⚠ Ignored ${event.ignored} City ticks from an earlier cycle`;
    default: return null;
  }
}

function describeResult(event: Extract<CouncilEvent, { type: "cycle_resolved" }>, names: Readonly<Record<string, string>>): string[] {
  const { result } = event;
  const lines = [`  Result of cycle ${result.cycle}:`];
  for (const place of PLACES) {
    const outcome = result.places[place];
    const scores = FACTIONS.map((faction) => `${faction} ${outcome.influence[faction].total} (${outcome.influence[faction].votes}v+${outcome.influence[faction].presence}p)`).join(" vs ");
    const ruler = outcome.control ? `${outcome.control.faction} rules: "${decreeById(outcome.control.decreeId)!.feedLine}"` : "Neutral";
    lines.push(`    ${place.padEnd(8)} ${scores.padEnd(36)} ${outcome.outcome.padEnd(11)} → ${ruler}`);
  }
  const rejected = result.rejectedVotes.map((entry) => `${names[entry.vote.agentKey]}@${entry.vote.place}:${entry.reason}`);
  if (rejected.length) lines.push(`    Not counted: ${rejected.join(", ")}`);
  return lines;
}

/** Runs the scripted demo and returns its printed lines. Deterministic: the same lines on every run. */
export async function runDemo(cycles = DEMO_CYCLES): Promise<{ lines: string[]; council: MemoryCouncil }> {
  // A virtual clock: each phase lasts its demo duration, so City ticks land in the right cycle window.
  let clockMs = Date.UTC(2026, 9, 19);
  const now = () => clockMs;
  const reader = new FixtureChainReader(FIXTURE_CHOGS);
  const feed = new FakeCityFeed(FIXTURE_CHOGS.map((chog) => chog.agentKey), now);
  const council = new MemoryCouncil({ reader, feed, chogs: FIXTURE_CHOGS, now });
  const names = Object.fromEntries(FIXTURE_CHOGS.map((chog) => [chog.agentKey, chog.name]));
  const lines: string[] = [];
  let printed = 0;
  // Events are flushed before each narrated line, so detections print in the order they happened.
  const say = (line: string) => { flush(); lines.push(line); };
  function flush(): void {
    for (const event of council.events.slice(printed)) {
      if (event.type === "cycle_resolved") lines.push(...describeResult(event, names));
      else if (event.type === "phase_changed") { if (event.phase === "propose") lines.push("", `═══ Cycle ${event.cycle} ═══`); }
      else {
        const text = describeEvent(event, names);
        if (text) lines.push(text);
      }
    }
    printed = council.events.length;
  }

  say("Chog Cult fixture demo: local fixtures only, no chain, wallet or model.");
  await council.start();
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const phase of PHASES) {
      if (phase !== "propose" || cycle > 0) {
        clockMs += TIMING.demo.phaseMs[PHASES[(PHASES.indexOf(phase) + PHASES.length - 1) % PHASES.length]!];
        await council.advance();
      }
      flush();
      if (phase === "debate" || phase === "vote") feed.runTicks(CITY_TICKS_PER_PHASE);
      const step = SCRIPT[cycle]?.[phase];
      if (step) await step({ council, reader, feed, say });
      flush();
    }
  }
  lines.push("", "Final standings:");
  for (const place of PLACES) {
    const control = council.placeControl[place];
    lines.push(`  ${place.padEnd(8)} ${control ? `${control.faction} since cycle ${control.sinceCycle}: ${decreeById(control.decreeId)!.title}` : "Neutral"}`);
  }
  const board = Object.entries(council.reputation).sort(([a, x], [b, y]) => y.glory - x.glory || y.loyalty - x.loyalty || (a < b ? -1 : 1));
  lines.push("  Reputation:", ...board.map(([agentKey, rep]) => `    ${(names[agentKey] ?? agentKey).padEnd(8)} glory ${rep.glory}, loyalty ${rep.loyalty}`));
  return { lines, council };
}
