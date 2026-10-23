import type pg from "pg";
import { fromCityEvent } from "../city/contract.js";
import type { CityFeed, CityFeedRead, CityTickEvent } from "../city/feed.js";

/**
 * Cult's view of the City running in the same server: City's committed `city_tick` events read from its
 * table, then checked and converted by the same contract code a remote City would go through.
 */
export class PgCityFeed implements CityFeed {
  readonly #pool: pg.Pool;
  readonly #pageSize: number;
  readonly #maxEvents: number;

  constructor(pool: pg.Pool, options: { pageSize?: number; maxEvents?: number } = {}) {
    this.#pool = pool;
    this.#pageSize = options.pageSize ?? 2000;
    // A production cycle (24 h) holds 8,640 City ticks; leave room for catch-up.
    this.#maxEvents = options.maxEvents ?? 50_000;
  }

  async eventsSince(revision: string): Promise<CityFeedRead> {
    const events: CityTickEvent[] = [];
    let cursor = revision;
    for (;;) {
      let rows: { revision: string; type: string; data: unknown; created_at: Date }[];
      try {
        ({ rows } = await this.#pool.query(
          "SELECT revision, type, data, created_at FROM city_events WHERE type = 'city_tick' AND revision > $1 ORDER BY revision LIMIT $2",
          [cursor, this.#pageSize]));
      } catch {
        return { available: false, reason: "City events could not be read" };
      }
      // A tick that fails the contract is a bug in this server, so it throws instead of counting as an outage.
      for (const row of rows) {
        const tick = fromCityEvent({ revision: String(row.revision), type: row.type, data: row.data, createdAt: row.created_at.toISOString() });
        if (tick) events.push(tick);
      }
      if (rows.length < this.#pageSize) return { available: true, events };
      cursor = String(rows.at(-1)!.revision);
      if (events.length >= this.#maxEvents) {
        return { available: false, reason: "Cult fell too far behind City; older activity was skipped", resumeFrom: cursor };
      }
    }
  }
}
