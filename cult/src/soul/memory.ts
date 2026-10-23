import type pg from "pg";
import { FACTION_INFO, decreeById, type FactionId, type Place } from "../rules.js";
import { placeName, type PublicChange, type TickActivity } from "../citysim/world.js";

type Change<T extends PublicChange["type"]> = Extract<PublicChange, { type: T }>;
const ofType = <T extends PublicChange["type"]>(type: T) => (change: PublicChange): change is Change<T> => change.type === type;

/** What the world publicly knows about a Chog, as short plain facts for its prompt. */
export async function publicMemory(pool: pg.Pool, agentKey: string): Promise<string[]> {
  const facts: string[] = [];
  const member = (await pool.query<{ faction: FactionId | null; stance: string }>("SELECT faction, stance FROM members WHERE agent_key = $1", [agentKey])).rows[0];
  const reputation = (await pool.query<{ loyalty: number; glory: number }>("SELECT loyalty, glory FROM reputation WHERE agent_key = $1", [agentKey])).rows[0];
  if (member?.faction) {
    facts.push(`You belong to ${FACTION_INFO[member.faction].name} in Chog Cult (glory ${reputation?.glory ?? 0}, loyalty ${reputation?.loyalty ?? 0}).`);
    const ruled = (await pool.query<{ place: Place; decree_id: string }>("SELECT place, decree_id FROM place_control WHERE faction = $1", [member.faction])).rows;
    if (ruled.length) facts.push(`Your faction rules ${ruled.map((row) => `the ${placeName(row.place)} (${decreeById(row.decree_id)?.title ?? row.decree_id})`).join(" and ")}.`);
  } else if (member) {
    facts.push("You have not joined a Cult faction.");
  }
  const resident = (await pool.query<{ home_level: number; home_style: string; focus: string; active: boolean; plot_id: string }>(
    "SELECT home_level, home_style, focus, active, plot_id FROM city_agents WHERE agent_key = $1", [agentKey])).rows[0];
  if (resident) {
    facts.push(`You live on plot ${resident.plot_id} in Chog City, ${resident.home_level === 0 ? "in a tent until you build a house" : `in a level ${resident.home_level} ${resident.home_style}`}.`);
    facts.push(resident.active ? `Your holder set you to ${resident.focus}.` : "Your holder has paused you.");
    const ticks = (await pool.query<{ data: { activities?: TickActivity[]; changes?: PublicChange[] } }>(
      "SELECT data FROM city_events WHERE type = 'city_tick' ORDER BY revision DESC LIMIT 40")).rows;
    const recent: string[] = [];
    for (const { data } of ticks) {
      const mine = data.activities?.find((activity) => activity.agentKey === agentKey);
      if (!mine || mine.kind === "idle") continue;
      const where = mine.location.kind === "place" ? `the ${placeName(mine.location.placeId)}` : "home";
      const changes = (data.changes ?? []).filter((change) => "agentKey" in change && change.agentKey === agentKey);
      const gathered = changes.find(ofType("gathered"));
      const completed = changes.find(ofType("build_completed"));
      if (mine.kind === "gather" && gathered) recent.push(`gathered ${gathered.amount} ${gathered.resource} at ${where}`);
      else if (mine.kind === "greet") recent.push(`greeted a neighbour at ${where}`);
      else if (mine.kind === "visit") recent.push(`spent time at ${where}`);
      else if (mine.kind === "build" && completed) recent.push(`finished a level ${completed.level} ${completed.homeStyle}`);
      if (recent.length >= 5) break;
    }
    if (recent.length) facts.push(`Recently you ${recent.join("; ")}.`);
  }
  return facts;
}

export function factionLabel(faction: FactionId | null): string {
  return faction ? FACTION_INFO[faction].name : "no faction";
}
