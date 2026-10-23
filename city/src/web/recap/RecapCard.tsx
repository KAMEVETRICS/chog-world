// The "While you were away" card: your Chogs' stories, your villager, and the town's news.
import { useEffect, useRef } from 'react';
import type { WorldState } from '../../shared/contracts';
import { appearanceFor, lookOf } from '../looks';
import { VillagerBadge } from '../town/TownPanel';
import { ChogFigure } from '../world/art';
import { NftPortrait } from '../world/NftPortrait';
import type { Recap } from './recap';
import './recap.css';

const MOOD_WORD: Record<string, string> = {
  cheerful: 'Cheerful',
  content: 'Content',
  tired: 'Tired',
  hungry: 'Hungry',
  bored: 'Bored',
  lonely: 'Lonely',
  miserable: 'Miserable',
};
const MOOD_TONE: Record<string, 'ok' | 'warn' | 'alert'> = { cheerful: 'ok', content: 'ok', miserable: 'alert' };

function Portrait({ world, chogKey }: { world: WorldState; chogKey: string }) {
  const agent = world.agents.find((a) => a.key === chogKey);
  return (
    <span className="recap-portrait">
      {agent ? (
        <NftPortrait image={lookOf(agent)?.image} appearance={appearanceFor(agent)} size={56} alt={agent.name} />
      ) : (
        <svg viewBox="-16 -24 32 28" width="46" height="40" aria-hidden="true">
          <ChogFigure scarf="var(--roof)" />
        </svg>
      )}
    </span>
  );
}

function away(recap: Recap): string {
  if (recap.days >= 2) return `${recap.days} village days went by`;
  if (recap.days === 1) return 'A village day went by';
  return `${recap.hours} village hours went by`;
}

export function RecapCard({ recap, world, onClose, onVisit }: { recap: Recap; world: WorldState; onClose: () => void; onVisit: (chogKey: string) => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => close.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const villager = recap.villagerKey ? world.citizens.find((c) => c.key === recap.villagerKey) ?? null : null;

  return (
    <div className="welcome-scrim">
      <section className="recap hud-card" role="dialog" aria-modal="true" aria-labelledby="recap-title">
        <p className="welcome-kicker">While you were away</p>
        <h2 id="recap-title" className="recap-title">
          {away(recap)}
        </h2>

        {recap.chogs.length ? (
          <ul className="recap-chogs" aria-label="Your Chogs">
            {recap.chogs.map((story) => {
              const living = world.agents.some((a) => a.key === story.key);
              return (
                <li key={story.key} className="recap-chog">
                  <Portrait world={world} chogKey={story.key} />
                  <div className="recap-chog-body">
                    <p className="recap-chog-name">
                      {story.name}
                      {story.mood ? <span className={`recap-mood recap-mood--${MOOD_TONE[story.mood] ?? 'warn'}`}>{MOOD_WORD[story.mood] ?? story.mood}</span> : null}
                    </p>
                    <ul className="recap-lines">
                      {story.lines.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  {living ? (
                    <button type="button" className="goal-go recap-visit" onClick={() => onVisit(story.key)}>
                      Visit
                      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M3 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {recap.villager.length && villager ? (
          <section className="recap-villager" aria-labelledby="recap-villager-h">
            <h3 id="recap-villager-h" className="section-title">
              Your villager
            </h3>
            <div className="recap-chog">
              <span className="recap-portrait recap-portrait--villager">
                <VillagerBadge look={villager.look} size={48} />
              </span>
              <div className="recap-chog-body">
                <p className="recap-chog-name">{villager.name}</p>
                <ul className="recap-lines">
                  {recap.villager.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        {recap.town.length ? (
          <section className="recap-town" aria-labelledby="recap-town-h">
            <h3 id="recap-town-h" className="section-title">
              Around the village
            </h3>
            <ul className="recap-news">
              {recap.town.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <button ref={close} type="button" className="welcome-choice recap-close" onClick={onClose}>
          <span className="welcome-choice-title">Back to the village</span>
        </button>
      </section>
    </div>
  );
}
