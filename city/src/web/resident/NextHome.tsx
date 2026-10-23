// "Saving up for": the one thing a Chog is working towards, in plain view. What its next home needs,
// what it already has, and what is missing; or how far along the build is.
import { RESOURCES, type AgentState } from '../../shared/contracts';
import { recipeForLevel } from '../../shared/rules';
import { homeName, RESOURCE_LABEL } from '../format';
import { GlyphIcon, Home } from '../world/art';

/** "a", "a and b", "a, b and c". */
const listOf = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export function NextHome({ agent }: { agent: AgentState }) {
  const c = agent.construction;
  const level = c ? c.targetLevel : agent.homeLevel + 1;
  const recipe = recipeForLevel(level);
  const style = agent.policy.homeStyle;

  if (!recipe) {
    return (
      <div className="next-home is-finished">
        <svg viewBox="-24 -36 48 54" width="54" height="60" aria-hidden="true">
          <Home style={agent.homeStyle} level={agent.homeLevel} />
        </svg>
        <div>
          <p className="next-home-title">Dream home finished</p>
          <p className="next-home-hint">
            A {homeName(agent.homeStyle, agent.homeLevel)}, as grand as homes get. Decorations make it cosier.
          </p>
        </div>
      </div>
    );
  }

  if (c) {
    const done = recipe.buildTicks - c.remainingTicks;
    return (
      <div className="next-home is-building">
        <svg viewBox="-24 -36 48 54" width="54" height="60" aria-hidden="true">
          <Home style={style} level={level} />
        </svg>
        <div className="next-home-body">
          <p className="next-home-title">
            Building a {homeName(style, level)} <span className="next-home-level">level {level}</span>
          </p>
          <span className="next-home-bar" role="img" aria-label={`${done} of ${recipe.buildTicks} hours of work done`}>
            <span style={{ width: `${(100 * done) / recipe.buildTicks}%` }} />
          </span>
          <p className="next-home-hint">
            {c.remainingTicks} {c.remainingTicks === 1 ? 'hour' : 'hours'} of work left. Materials are set aside.
          </p>
        </div>
      </div>
    );
  }

  const parts = RESOURCES.filter((r) => recipe.costs[r] > 0).map((r) => {
    const have = Math.min(recipe.costs[r], agent.inventory[r].total - agent.inventory[r].reserved);
    return { r, have, need: recipe.costs[r] };
  });
  const missing = parts.filter((p) => p.have < p.need);
  const ready = missing.length === 0;

  return (
    <div className={`next-home${ready ? ' is-ready' : ''}`}>
      <svg viewBox="-24 -36 48 54" width="54" height="60" aria-hidden="true" className="next-home-ghost">
        <Home style={style} level={level} />
      </svg>
      <div className="next-home-body">
        <p className="next-home-title">
          Saving up for a {homeName(style, level)} <span className="next-home-level">level {level}</span>
        </p>
        <ul className="next-home-parts" aria-label="Materials for the next home">
          {parts.map(({ r, have, need }) => (
            <li key={r} className={`next-part next-part--${r}${have >= need ? ' is-met' : ''}`}>
              <GlyphIcon glyph={r} size={14} />
              <span className="num">
                {have}/{need}
              </span>
              <span className="visually-hidden">{RESOURCE_LABEL[r].toLowerCase()}</span>
            </li>
          ))}
        </ul>
        <p className="next-home-hint">
          {agent.policy.focus !== 'builder'
            ? `Only builders build. ${agent.name} is a ${agent.policy.focus}, so this waits until its focus is Builder.`
            : ready
              ? 'Everything is ready. It starts building at the next chance.'
              : `Still needs ${listOf(missing.map((p) => `${p.need - p.have} ${p.r}`))}.`}
        </p>
      </div>
    </div>
  );
}
