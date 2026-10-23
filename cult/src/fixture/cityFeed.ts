import type { AgentKey } from "../shared/identity.js";
import type { CityActivity, CityFeed, CityFeedRead, CityLocation, CityTickEvent } from "../city/feed.js";
import { stableHash } from "../engine/hash.js";

const LOCATIONS: readonly CityLocation[] = ["plaza", "tavern", "workshop", "forest", "quarry", "farm", "home"];
const KINDS: readonly CityActivity["kind"][] = ["visit", "greet", "gather", "build", "idle"];

/**
 * A stand-in for Chog City's public feed. `runTicks` produces deterministic activity for the residents, as
 * if City's 10-second scheduler had run; `setDown` simulates City being unreachable.
 */
export class FakeCityFeed implements CityFeed {
  readonly #residents: readonly AgentKey[];
  readonly #seed: string;
  readonly #events: CityTickEvent[] = [];
  #down = false;

  readonly #now: () => number;

  constructor(residents: readonly AgentKey[], now: () => number, seed = "fixture-city") {
    this.#residents = [...residents].sort();
    this.#now = now;
    this.#seed = seed;
  }

  /** Commits `count` City ticks, 10 seconds apart, starting at the current time. */
  runTicks(count: number): void {
    const start = this.#now();
    for (let index = 0; index < count; index++) {
      const tick = this.#events.length + 1;
      const activities = this.#residents.map((agentKey): CityActivity => {
        const roll = stableHash(`${this.#seed}|${tick}|${agentKey}`);
        return { agentKey, kind: KINDS[roll % KINDS.length]!, location: LOCATIONS[Math.floor(roll / KINDS.length) % LOCATIONS.length]! };
      });
      this.#events.push({ revision: String(tick), tick: String(tick), committedAtMs: start + index * 10_000, activities });
    }
  }

  setDown(down: boolean): void {
    this.#down = down;
  }

  async eventsSince(revision: string): Promise<CityFeedRead> {
    if (this.#down) return { available: false, reason: "City feed unreachable" };
    return { available: true, events: this.#events.filter((event) => BigInt(event.revision) > BigInt(revision)) };
  }
}
