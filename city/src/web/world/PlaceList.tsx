// Keyboard/screen-reader alternative to the map: every resident, grouped by where they are.
import type { AgentState, WorldState } from '../../shared/contracts';
import { activityOf, placeName } from '../format';
import { ChogFigure, scarfFor } from './art';

function whereLabel(agent: AgentState, world: WorldState): string {
  if (agent.location.kind === 'plot') return 'At home';
  return placeName(world, agent.location.placeId);
}

export function PlaceList({
  world,
  selectedKey,
  onSelect,
  mine,
}: {
  world: WorldState;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  mine: Set<string>;
}) {
  const groups = new Map<string, AgentState[]>();
  for (const agent of world.agents) {
    const where = whereLabel(agent, world);
    groups.set(where, [...(groups.get(where) ?? []), agent]);
  }
  const order = ['At home', ...world.places.map((p) => p.name)];
  const sorted = [...groups.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));

  return (
    <nav className="roster" aria-label="Residents by location">
      {sorted.map(([where, agents]) => (
        <section key={where} className="roster-group">
          <h3 className="roster-heading">
            {where} <span className="num">{agents.length}</span>
          </h3>
          <ul>
            {agents.map((agent) => {
              const activity = activityOf(agent, world);
              return (
                <li key={agent.key}>
                  <button
                    type="button"
                    className="roster-item"
                    aria-current={agent.key === selectedKey ? 'true' : undefined}
                    onClick={() => onSelect(agent.key)}
                  >
                    <svg width="28" height="28" viewBox="-14 -24 28 28" aria-hidden="true">
                      <ChogFigure scarf={scarfFor(agent.identity.tokenId)} />
                    </svg>
                    <span className="roster-text">
                      <span className="roster-name">
                        {agent.name}
                        {mine.has(agent.key) ? <span className="tag tag--mine">Yours</span> : null}
                      </span>
                      <span className="roster-activity">{activity.label}</span>
                    </span>
                    <span className="roster-id num">#{agent.identity.tokenId}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
