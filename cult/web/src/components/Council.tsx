import { FACTIONS, PHASES, PLACES, type FactionId, type Place } from "../../../src/rules";
import type { EventDto, SnapshotDto } from "../api";
import type { Connection } from "../useCult";
import { PHASE_NAMES, PLACE_NAMES, decreeTitle, describeEvent, factionName } from "../describe";

function countdown(targetIso: string, now: number): string {
  const seconds = Math.max(0, Math.round((Date.parse(targetIso) - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

const CONNECTION_TEXT: Record<Connection, string> = { connecting: "Connecting…", live: "Live", reconnecting: "Reconnecting… (showing last known state)" };

export function PhaseBar({ snapshot, now, connection }: { snapshot: SnapshotDto; now: number; connection: Connection }) {
  return (
    <section className="phase-bar" aria-label="Council cycle">
      <div className="cycle">Cycle {snapshot.cycle}</div>
      <ol className="phases">
        {PHASES.map((phase) => (
          <li key={phase} aria-current={phase === snapshot.phase ? "step" : undefined} className={phase === snapshot.phase ? "current" : undefined}>
            {PHASE_NAMES[phase]}
          </li>
        ))}
      </ol>
      <p className="countdown">
        {PHASE_NAMES[snapshot.phase]} ends in <strong>{countdown(snapshot.nextBoundaryAt, now)}</strong>
      </p>
      <p className={`connection ${connection}`} role="status">{CONNECTION_TEXT[connection]}</p>
    </section>
  );
}

function tally(snapshot: SnapshotDto, place: Place): Record<FactionId, number> {
  const counts = { crown: 0, chaos: 0 } as Record<FactionId, number>;
  for (const member of snapshot.members) {
    const vote = member.currentVotes.find((entry) => entry.place === place);
    if (member.faction && vote?.decreeId) counts[member.faction] += 1;
  }
  return counts;
}

export function Places({ snapshot }: { snapshot: SnapshotDto }) {
  const voting = snapshot.phase === "vote" || snapshot.phase === "resolve";
  return (
    <section aria-labelledby="places-heading">
      <h2 id="places-heading">Places</h2>
      <ul className="places">
        {snapshot.places.map((place) => {
          const counts = tally(snapshot, place.place);
          return (
            <li key={place.place} className={`place ruler-${place.ruler ?? "neutral"}`}>
              <h3>{PLACE_NAMES[place.place]}</h3>
              <p className="ruler"><span className="badge">{place.ruler ? factionName(place.ruler) : "Neutral"}</span>{place.sinceCycle !== null && <span className="muted"> since cycle {place.sinceCycle}</span>}</p>
              {place.decree ? <p><strong>{place.decree.title}.</strong> {place.decree.feedLine}</p> : <p className="muted">No decree yet.</p>}
              {voting && <p className="tally">This cycle's votes: {FACTIONS.map((faction) => `${factionName(faction)} ${counts[faction]}`).join(" · ")}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Factions({ snapshot }: { snapshot: SnapshotDto }) {
  return (
    <section aria-labelledby="factions-heading">
      <h2 id="factions-heading">Factions</h2>
      <div className="factions">
        {snapshot.factions.map((faction) => (
          <article key={faction.id} className={`faction faction-${faction.id}`}>
            <h3>{faction.name}</h3>
            <p className="muted">{faction.creed}</p>
            <dl>
              <dt>Members</dt><dd>{faction.members}</dd>
              <dt>Rules</dt><dd>{faction.placesRuled.length ? faction.placesRuled.map((place) => PLACE_NAMES[place]).join(", ") : "Nothing yet"}</dd>
              <dt>Glory</dt><dd>{faction.glory}</dd>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

/** Every Chog in one table: the accessible alternative to scanning the panels. */
export function ChogTable({ snapshot }: { snapshot: SnapshotDto }) {
  return (
    <section aria-labelledby="chogs-heading">
      <h2 id="chogs-heading">All Chogs</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Chog</th><th scope="col">Faction</th><th scope="col">Stance</th>{PLACES.map((place) => <th key={place} scope="col">{PLACE_NAMES[place]} vote</th>)}<th scope="col">Glory</th><th scope="col">Loyalty</th><th scope="col">Ownership</th></tr></thead>
          <tbody>
            {snapshot.members.map((member) => (
              <tr key={member.agentKey}>
                <th scope="row">{member.name}</th>
                <td>{factionName(member.faction)}</td>
                <td>{member.faction ? (member.stance === "persona" ? "Agent votes" : "Abstains") : "—"}</td>
                {PLACES.map((place) => {
                  const vote = member.currentVotes.find((entry) => entry.place === place);
                  return <td key={place}>{vote ? `${decreeTitle(vote.decreeId)}${vote.source === "holder" ? " (holder)" : ""}` : "—"}</td>;
                })}
                <td>{member.reputation.glory}</td>
                <td>{member.reputation.loyalty}</td>
                <td>{member.control === "verified" ? "Verified" : member.control === "unavailable" ? "Can't check now" : member.control}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function Feed({ feed, snapshot }: { feed: readonly EventDto[]; snapshot: SnapshotDto }) {
  const names = new Map(snapshot.members.map((member) => [member.agentKey, member.name]));
  const lines = [...feed].reverse().map((event) => ({ event, line: describeEvent(event, names) })).filter((entry) => entry.line);
  return (
    <section aria-labelledby="feed-heading">
      <h2 id="feed-heading">Council feed</h2>
      <p className="muted small">Lines marked AI were written by the Chog itself, paid from its holder's credits; Scripted lines come from its traits. Votes are always counted by the rules.</p>
      <ol className="feed" aria-live="polite" aria-relevant="additions">
        {lines.map(({ event, line }) => (
          <li key={event.revision} className={`tone-${line!.tone}`}>
            {line!.tone === "scripted" && <span className="label">Scripted</span>}
            {line!.tone === "ai" && <span className="label label-ai">AI</span>}
            {line!.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
