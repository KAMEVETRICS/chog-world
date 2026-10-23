// Home level and the current build, as discrete eligible-tick steps.
import type { AgentState } from '../../shared/contracts';
import { MAX_HOME_LEVEL, recipeForLevel } from '../../shared/rules';
import { homeName, hours } from '../format';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function BuildingProgress({ agent }: { agent: AgentState }) {
  const c = agent.construction;
  const next = recipeForLevel(agent.homeLevel + 1);
  const total = c ? recipeForLevel(c.targetLevel)?.buildTicks ?? 1 : 0;
  const done = c ? total - c.remainingTicks : 0;

  return (
    <div className="home-card">
      <div className="home-levels" aria-label={`Home level ${agent.homeLevel} of ${MAX_HOME_LEVEL}`}>
        {Array.from({ length: MAX_HOME_LEVEL }, (_, i) => (
          <span key={i} className={`home-level${i < agent.homeLevel ? ' is-built' : ''}${c && i === agent.homeLevel ? ' is-building' : ''}`} />
        ))}
      </div>
      <p className="home-title">
        {agent.homeLevel === 0 ? 'An empty lot' : `${cap(homeName(agent.homeStyle, agent.homeLevel))} · level ${agent.homeLevel}`}
      </p>
      {c ? (
        <div className="build">
          <p className="build-line">
            Raising level {c.targetLevel} · <span className="num">{hours(c.remainingTicks)}</span> of work left
          </p>
          <ol className="build-steps" aria-label={`${done} of ${total} hours of work done`}>
            {Array.from({ length: total }, (_, i) => (
              <li key={i} className={i < done ? 'is-done' : ''} />
            ))}
          </ol>
          <p className="build-note">
            Holding {c.costs.wood} wood, {c.costs.stone} stone and {c.costs.food} food until it's finished.
          </p>
        </div>
      ) : next ? (
        <p className="build-note">
          Level {next.level} needs {next.costs.wood} wood, {next.costs.stone} stone and {next.costs.food} food, then {hours(next.buildTicks)} of work.
        </p>
      ) : (
        <p className="build-note">Fully built. This home is finished.</p>
      )}
    </div>
  );
}
