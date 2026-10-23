// Village log: committed events, newest first, grouped by tick.
import type { CityEvent, WorldState } from '../../shared/contracts';
import { describeChange } from '../format';

const FEED_SOURCE: Partial<Record<CityEvent['type'], string>> = { citizen_joined: 'Citizen', job_changed: 'Citizen', params_changed: 'City Hall', city_action: 'Town', council: 'Council' };

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
    return <p className="feed-empty">Nothing yet. The village wakes on the next tick.</p>;
  }

  return (
    <ol className="feed" aria-label="Village log">
      {groups.map(({ event, lines }) => (
        <li key={event.revision} className="feed-tick">
          <span className="feed-when num">
            {event.type === 'city_tick' ? `Tick ${event.data.tick}` : FEED_SOURCE[event.type] ?? 'Holder'}
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
