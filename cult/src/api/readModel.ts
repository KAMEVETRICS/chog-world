import type pg from "pg";
import { FACTIONS, FACTION_INFO, PLACES, decreeById, type FactionId, type Phase, type Place, type Stance } from "../rules.js";
import type { AgentIdentity } from "../shared/identity.js";
import type { ControlStatus, FactionSpan } from "../engine/types.js";

// Public DTOs. They never include holder addresses, sessions or anything private.

export interface PlaceDto {
  readonly place: Place;
  readonly ruler: FactionId | null;
  readonly sinceCycle: number | null;
  readonly decree: { readonly id: string; readonly title: string; readonly banner: string; readonly feedLine: string } | null;
}

export interface FactionDto {
  readonly id: FactionId;
  readonly name: string;
  readonly creed: string;
  readonly members: number;
  readonly placesRuled: readonly Place[];
  readonly glory: number;
}

export interface VoteDto {
  readonly place: Place;
  readonly decreeId: string | null;
  readonly source: "agent" | "holder";
}

export interface MemberDto {
  readonly agentKey: string;
  readonly name: string;
  readonly identity: AgentIdentity;
  readonly traits: Readonly<Record<string, string>>;
  readonly faction: FactionId | null;
  readonly stance: Stance;
  readonly joinedCycle: number | null;
  readonly control: ControlStatus;
  readonly history: readonly FactionSpan[];
  readonly reputation: { readonly loyalty: number; readonly glory: number };
  /** This cycle's effective votes: a holder override (or abstention) replaces the agent's vote. */
  readonly currentVotes: readonly VoteDto[];
}

export interface EventDto {
  readonly revision: string;
  readonly cycle: number;
  readonly type: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface SnapshotDto {
  readonly revision: string;
  readonly cycle: number;
  readonly phase: Phase;
  readonly phaseStartedAt: string;
  readonly nextBoundaryAt: string;
  readonly places: readonly PlaceDto[];
  readonly factions: readonly FactionDto[];
  readonly members: readonly MemberDto[];
  readonly recentEvents: readonly EventDto[];
}

const RECENT_EVENTS = 50;

/** Reads everything public in one REPEATABLE READ transaction, so all parts agree with `revision`. */
export async function readSnapshot(pool: pg.Pool): Promise<SnapshotDto> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const runtime = (await db.query("SELECT cycle, phase, phase_started_at, next_boundary_at, revision FROM cult_runtime WHERE id = 1")).rows[0];
    if (!runtime) throw new Error("Chog Cult is not initialized.");
    const members = (await db.query("SELECT agent_key, name, identity, traits, faction, stance, joined_cycle, control_status, history FROM members ORDER BY agent_key")).rows;
    const reputation = new Map((await db.query("SELECT agent_key, loyalty, glory FROM reputation")).rows.map((row) => [row.agent_key as string, { loyalty: row.loyalty as number, glory: row.glory as number }]));
    const votes = (await db.query("SELECT agent_key, place, source, decree_id FROM votes WHERE cycle = $1 ORDER BY agent_key, place, source", [runtime.cycle])).rows;
    const control = (await db.query("SELECT place, faction, decree_id, since_cycle FROM place_control")).rows;
    const events = (await db.query("SELECT revision, cycle, type, payload, created_at FROM cult_events ORDER BY revision DESC LIMIT $1", [RECENT_EVENTS])).rows;
    await db.query("COMMIT");

    const effective = new Map<string, VoteDto[]>();
    for (const vote of votes) {
      const list = effective.get(vote.agent_key) ?? [];
      const existing = list.findIndex((entry) => entry.place === vote.place);
      const dto: VoteDto = { place: vote.place, decreeId: vote.decree_id, source: vote.source };
      // Rows are ordered agent before holder, so a holder record replaces the agent's for that place.
      if (existing === -1) list.push(dto); else list[existing] = dto;
      effective.set(vote.agent_key, list);
    }

    const memberDtos: MemberDto[] = members.map((row) => ({
      agentKey: row.agent_key, name: row.name, identity: row.identity, traits: row.traits, faction: row.faction, stance: row.stance,
      joinedCycle: row.joined_cycle, control: row.control_status, history: row.history,
      reputation: reputation.get(row.agent_key) ?? { loyalty: 0, glory: 0 },
      currentVotes: (effective.get(row.agent_key) ?? []).sort((a, b) => PLACES.indexOf(a.place) - PLACES.indexOf(b.place)),
    }));
    const placeRows = new Map(control.map((row) => [row.place as Place, row]));
    const places: PlaceDto[] = PLACES.map((place) => {
      const row = placeRows.get(place);
      const decree = row?.decree_id ? decreeById(row.decree_id) : undefined;
      return {
        place, ruler: row?.faction ?? null, sinceCycle: row?.since_cycle ?? null,
        decree: decree ? { id: decree.id, title: decree.title, banner: decree.banner, feedLine: decree.feedLine } : null,
      };
    });
    const factions: FactionDto[] = FACTIONS.map((id) => ({
      id, ...FACTION_INFO[id],
      members: memberDtos.filter((member) => member.faction === id).length,
      placesRuled: places.filter((place) => place.ruler === id).map((place) => place.place),
      glory: memberDtos.filter((member) => member.faction === id).reduce((sum, member) => sum + member.reputation.glory, 0),
    }));
    return {
      revision: String(runtime.revision), cycle: runtime.cycle, phase: runtime.phase,
      phaseStartedAt: runtime.phase_started_at.toISOString(), nextBoundaryAt: runtime.next_boundary_at.toISOString(),
      places, factions, members: memberDtos,
      recentEvents: events.reverse().map(toEventDto),
    };
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

export function toEventDto(row: { revision: string | number; cycle: number; type: string; payload: unknown; created_at: Date }): EventDto {
  return { revision: String(row.revision), cycle: row.cycle, type: row.type, payload: row.payload, createdAt: row.created_at.toISOString() };
}
