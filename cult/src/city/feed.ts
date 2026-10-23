import type { AgentKey } from "../shared/identity.js";
import { PLACES, type Place } from "../rules.js";
import type { PresenceRecord } from "../engine/types.js";

/**
 * What Cult needs from Chog City's public feed. City's `city_tick` events carry activity lines; this is the
 * minimal shape Cult reads from them. Agree the exact mapping with the City teammate in Task 7.
 */
export type CityLocation = Place | "forest" | "quarry" | "farm" | "home";

export interface CityActivity {
  readonly agentKey: AgentKey;
  readonly kind: "visit" | "greet" | "gather" | "build" | "idle";
  readonly location: CityLocation;
}

export interface CityTickEvent {
  /** City's commit-ordered public revision, a decimal string. */
  readonly revision: string;
  readonly tick: string;
  /** When City committed the tick (ms since epoch); decides which Cult cycle the activity belongs to. */
  readonly committedAtMs: number;
  readonly activities: readonly CityActivity[];
}

export type CityFeedRead =
  | { readonly available: true; readonly events: readonly CityTickEvent[] }
  /** `resumeFrom`: City history before this revision is lost; move the cursor here so later cycles count again. */
  | { readonly available: false; readonly reason: string; readonly resumeFrom?: string };

export interface CityFeed {
  /** Committed City tick events after `revision` (exclusive), oldest first. */
  eventsSince(revision: string): Promise<CityFeedRead>;
}

const COUNTED = new Set<string>(PLACES);

/**
 * Turns City activity into presence for `cycle`: one point per visit or greet at a Cult place, counting only
 * ticks committed inside the cycle's window [fromMs, toMs). Older ticks (for example ones held back while
 * the feed was down) are reported as late and never counted in a later cycle.
 */
export function presenceFromCity(events: readonly CityTickEvent[], cycle: number, window: { fromMs: number; toMs: number }): { records: PresenceRecord[]; late: number } {
  const records: PresenceRecord[] = [];
  let late = 0;
  for (const event of events) {
    if (event.committedAtMs < window.fromMs) { late += 1; continue; }
    if (event.committedAtMs >= window.toMs) continue;
    for (const activity of event.activities) {
      if ((activity.kind === "visit" || activity.kind === "greet") && COUNTED.has(activity.location)) {
        records.push({ cycle, agentKey: activity.agentKey, place: activity.location as Place, points: 1, cityRevision: event.revision });
      }
    }
  }
  return { records, late };
}
