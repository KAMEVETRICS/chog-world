// The Cult ⇄ City contract in code. The prose version, with examples, is
// docs/superpowers/specs/2026-10-19-cult-city-contract.md. Change both together.

import type { AgentKey } from "../shared/identity.js";
import type { FactionId, Place } from "../rules.js";
import type { CityActivity, CityLocation, CityTickEvent } from "./feed.js";

// ---- What Cult reads from City: GET /api/city/events (SSE), City's CityEvent envelope ----

export interface CityEvent {
  readonly revision: string;
  readonly type: string;
  readonly data: unknown;
  /** City's commit time for the event (ISO 8601). Cult uses it to place a tick in a Cult cycle. */
  readonly createdAt: string;
}

export type CityPlaceId = "plaza" | "tavern" | "workshop" | "forest" | "quarry" | "farm";

/** The `data` of a `city_tick` event: one structured line per resident that acted in the tick. */
export interface CityTickData {
  readonly tick: string;
  readonly activities: readonly {
    readonly agentKey: string;
    readonly kind: CityActivity["kind"];
    readonly location: { readonly kind: "place"; readonly placeId: CityPlaceId } | { readonly kind: "plot"; readonly plotId: string };
  }[];
}

// ---- What City reads from Cult: GET /api/cult/places and the place_control_changed event ----

export interface CultPlaceControl {
  readonly faction: FactionId;
  readonly decreeId: string;
  readonly sinceCycle: number;
}

/** `data` of an SSE `place_control_changed` event from GET /api/cult/events is an EventDto whose payload is this. */
export interface PlaceControlChangedPayload {
  readonly place: Place;
  readonly control: CultPlaceControl | null;
}

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const AGENT_KEY = /^(31337|10143|143):0x[0-9a-f]{40}:0x[0-9a-f]{40}:0x[0-9a-f]{40}:(0|[1-9][0-9]{0,77}):(0|[1-9][0-9]{0,77})$/;
const KINDS = new Set<string>(["visit", "greet", "gather", "build", "idle"]);
const PLACE_IDS = new Set<string>(["plaza", "tavern", "workshop", "forest", "quarry", "farm"]);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validates one City event and converts a `city_tick` into what Cult counts. Returns `null` for other
 * event types; throws on a malformed `city_tick`, so a contract break is loud instead of silently
 * counting nothing.
 */
export function fromCityEvent(event: unknown): CityTickEvent | null {
  if (!isObject(event) || typeof event.revision !== "string" || !DECIMAL.test(event.revision) || typeof event.type !== "string") {
    throw new Error("City event is missing a decimal revision or a type.");
  }
  if (event.type !== "city_tick") return null;
  const committedAtMs = typeof event.createdAt === "string" ? Date.parse(event.createdAt) : Number.NaN;
  if (!Number.isFinite(committedAtMs)) throw new Error(`City tick ${event.revision} has no valid createdAt.`);
  const data = event.data;
  if (!isObject(data) || typeof data.tick !== "string" || !DECIMAL.test(data.tick) || !Array.isArray(data.activities)) {
    throw new Error(`City tick ${event.revision} has no tick number or activities list.`);
  }
  const activities: CityActivity[] = data.activities.map((activity, index) => {
    if (!isObject(activity) || typeof activity.agentKey !== "string" || !AGENT_KEY.test(activity.agentKey) || typeof activity.kind !== "string" || !KINDS.has(activity.kind) || !isObject(activity.location)) {
      throw new Error(`City tick ${event.revision} activity ${index} does not match the contract.`);
    }
    const location = activity.location;
    let mapped: CityLocation;
    if (location.kind === "place" && typeof location.placeId === "string" && PLACE_IDS.has(location.placeId)) mapped = location.placeId as CityLocation;
    else if (location.kind === "plot" && typeof location.plotId === "string") mapped = "home";
    else throw new Error(`City tick ${event.revision} activity ${index} has an unknown location.`);
    return { agentKey: activity.agentKey as AgentKey, kind: activity.kind as CityActivity["kind"], location: mapped };
  });
  return { revision: event.revision, tick: data.tick, committedAtMs, activities };
}
