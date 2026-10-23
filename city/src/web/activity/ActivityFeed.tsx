// Village log: committed events, newest first, grouped by the village hour they happened in.
import type { CityEvent, WorldState } from '../../shared/contracts';
import { describeChange, whenLabel } from '../format';
import { dayNumber, phaseName, timeOfDay } from '../world3d/daylight';

const FEED_SOURCE: Partial<Record<CityEvent['type'], string>> = { citizen_joined: 'Villagers', job_changed: 'Villagers', params_changed: 'City Hall', city_action: 'Town', council: 'Council' };

export function ActivityFeed({ events, world, filterKey }: { events: CityEvent[]; world: WorldState; filterKey?: string | null }) {
  const groups = [...events]
    .reverse()
    .map((event) => ({
      event,
      lines: event.data.changes
        .filter((c) => !filterKey || ('agentKey' in c && c.agentKey === filterKey) || ('otherKey' in c && c.otherKey === filterKey))
        .map((c) => describeChange(c, world))
        .filter((line): line is string => line !== null),
    }))
    .filter((g) => g.lines.length > 0)
    .slice(0, 30);

  if (groups.length === 0) {
    return <p className="feed-empty">Nothing yet. The village stirs within the hour.</p>;
  }

  return (
    <ol className="feed" aria-label="Village log">
      {groups.map(({ event, lines }) => (
        <li key={event.revision} className="feed-tick">
          <span className="feed-when num" aria-label={event.type === 'city_tick' ? whenLabel(event.data.tick) : undefined}>
            {event.type === 'city_tick' ? (
              <>
                <span className="feed-day">Day {dayNumber(Number(event.data.tick))}</span>
                <span className="feed-phase">{phaseName(timeOfDay(Number(event.data.tick)))}</span>
              </>
            ) : (
              FEED_SOURCE[event.type] ?? 'Holder'
            )}
          </span>
          <ul>
            {lines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
