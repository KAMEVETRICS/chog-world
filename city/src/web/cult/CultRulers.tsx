// Who rules the Plaza, Tavern and Workshop in Chog Cult, and the decree in force there.
import type { WorldState } from '../../shared/contracts';
import { placeName } from '../format';
import { FACTION_NAME, RULED_PLACES, type Rulers } from './rulers';

export function CultRulers({ rulers, world }: { rulers: Rulers; world: WorldState }) {
  return (
    <section className="rulers" aria-labelledby="rulers-h">
      <h3 id="rulers-h" className="section-title">
        Who rules
        <span className="section-aside">{rulers.stale ? "Can't reach the Cult · may be out of date" : `Chog Cult · cycle ${rulers.cycle}`}</span>
      </h3>
      <ul className="rulers-list">
        {RULED_PLACES.map((id) => {
          const rule = rulers.places[id];
          return (
            <li key={id} className="rulers-item">
              <span className="rulers-place">{placeName(world, id)}</span>
              {rule?.ruler ? (
                <span className="rulers-rule">
                  <span className={`tag ruler--${rule.ruler}`}>{FACTION_NAME[rule.ruler]}</span>
                  {rule.decree ? <span className="rulers-decree">{rule.decree.title}</span> : null}
                </span>
              ) : (
                <span className="rulers-neutral">Neutral</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="rulers-note">
        Social Chogs in a faction earn it presence here. <a href="/cult/">Open Chog Cult</a> to join a faction and vote.
      </p>
    </section>
  );
}
