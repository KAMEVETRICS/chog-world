import type pg from "pg";
import type { EventSource } from "../api/events.js";
import type { AgentRow, CitizenRow, RuntimeRow } from "./pgCity.js";
import { worldOf } from "./pgCity.js";
import type { CityEvent, CitySnapshot } from "./world.js";

// Public City reads in City's own contract shapes (../city/src/shared/contracts.ts). Holder addresses appear
// only as each Chog's on-chain controller; sessions, keys and signatures never do.

const RECENT_EVENTS = 60;

interface EventRow { revision: string | number; type: string; data: unknown; created_at: Date }

export function toCityEvent(row: EventRow): CityEvent {
  return { revision: String(row.revision), type: row.type as CityEvent["type"], data: row.data as CityEvent["data"], createdAt: row.created_at.toISOString() };
}

export const CITY_EVENTS: EventSource<CityEvent> = {
  async latest(pool) {
    const { rows } = await pool.query<{ revision: string }>("SELECT revision FROM city_runtime WHERE id = 1");
    return BigInt(rows[0]?.revision ?? 0);
  },
  async after(pool, revision, limit) {
    const { rows } = await pool.query<EventRow>("SELECT revision, type, data, created_at FROM city_events WHERE revision > $1 ORDER BY revision LIMIT $2", [revision.toString(), limit]);
    return rows.map(toCityEvent);
  },
};

/** The whole village in one REPEATABLE READ transaction, so the world, events and revision agree. */
export async function readCitySnapshot(pool: pg.Pool): Promise<CitySnapshot> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const runtime = (await db.query<RuntimeRow>("SELECT * FROM city_runtime WHERE id = 1")).rows[0];
    if (!runtime) throw new Error("Chog City is not initialized.");
    const agents = (await db.query<AgentRow>("SELECT * FROM city_agents ORDER BY agent_key")).rows;
    const citizens = (await db.query<CitizenRow>("SELECT * FROM city_citizens ORDER BY citizen_key")).rows;
    const events = (await db.query<EventRow>("SELECT revision, type, data, created_at FROM city_events ORDER BY revision DESC LIMIT $1", [RECENT_EVENTS])).rows;
    await db.query("COMMIT");
    return {
      revision: String(runtime.revision), tick: String(runtime.tick), nextDueAt: runtime.next_due_at.toISOString(),
      world: worldOf(runtime, agents, citizens), recentEvents: events.reverse().map(toCityEvent),
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
