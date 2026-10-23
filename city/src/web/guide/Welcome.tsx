// First visit: what Chog City is in three lines, then one question: how do you want to play?
import { useEffect, useRef } from 'react';
import type { VillagerLook } from '../../shared/contracts';
import type { Appearance } from '../../shared/looks';
import { NftPortrait } from '../world/NftPortrait';
import { ChogFigure } from '../world/art';
import { VillagerBadge } from '../town/TownPanel';

export type WelcomeChoice = 'holder' | 'villager' | 'look';

/** Real neighbours to introduce: a Chog living here and a villager who moved in. */
export interface WelcomeCast {
  chog: { name: string; image: string | null; appearance: Appearance } | null;
  villager: { name: string; look: VillagerLook } | null;
}

function ChogPortrait({ chog }: { chog: WelcomeCast['chog'] }) {
  if (!chog) {
    return (
      <svg viewBox="-16 -24 32 28" width="52" height="46" aria-hidden="true">
        <ChogFigure scarf="var(--roof)" />
      </svg>
    );
  }
  return (
    <span className="welcome-portrait">
      <NftPortrait image={chog.image} appearance={chog.appearance} size={52} alt="" />
    </span>
  );
}

function BallotArt() {
  return (
    <svg viewBox="-16 -16 32 32" width="52" height="52" aria-hidden="true">
      <rect x="-11" y="-2" width="22" height="13" rx="2.5" fill="var(--wood-soft)" stroke="var(--ink)" strokeWidth="1.4" />
      <rect x="-5" y="-2.6" width="10" height="1.6" rx="0.8" fill="var(--ink)" />
      <g transform="rotate(-8)">
        <rect x="-6" y="-14" width="12" height="11" rx="1.5" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1.4" />
        <path d="M-3 -8.5 L-0.8 -6.3 L3.4 -10.8" fill="none" stroke="var(--ok)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Welcome({ cast, onChoose }: { cast: WelcomeCast; onChoose: (choice: WelcomeChoice) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChoose('look');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onChoose]);

  return (
    <div className="welcome-scrim">
      <section className="welcome hud-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-lede">
        <p className="welcome-kicker">Welcome to</p>
        <h2 id="welcome-title" className="welcome-title">
          Chog City
        </h2>
        <p id="welcome-lede" className="welcome-lede">
          A little village where Chogs live their own lives, and anyone can move in next door.
        </p>

        <ol className="welcome-points">
          <li>
            <ChogPortrait chog={cast.chog} />
            <div>
              <h3>Chogs run themselves</h3>
              <p>
                Every Chog NFT lives here as a character{cast.chog ? <>, like {cast.chog.name}</> : null}. It gathers wood and food, builds its home and sleeps at night,
                even when you're away.
              </p>
            </div>
          </li>
          <li>
            {cast.villager ? <VillagerBadge look={cast.villager.look} size={52} /> : <span className="welcome-art-gap" aria-hidden="true" />}
            <div>
              <h3>Anyone can move in</h3>
              <p>
                No NFT? Make a villager{cast.villager ? <>, like {cast.villager.name} did</> : null}, take a job and earn coins for the town.
              </p>
            </div>
          </li>
          <li>
            <BallotArt />
            <div>
              <h3>The town writes its own rules</h3>
              <p>Each morning Chogs propose changes, like higher wages. Villagers vote them in.</p>
            </div>
          </li>
        </ol>

        <p className="welcome-ask">How do you want to play?</p>
        <div className="welcome-choices">
          <button ref={first} type="button" className="welcome-choice" onClick={() => onChoose('villager')}>
            <span className="welcome-choice-title">Move in as a villager</span>
            <span className="welcome-choice-hint">Free. No NFT needed.</span>
          </button>
          <button type="button" className="welcome-choice" onClick={() => onChoose('holder')}>
            <span className="welcome-choice-title">I have a Chog</span>
            <span className="welcome-choice-hint">Look after it and speak for it.</span>
          </button>
        </div>
        <button type="button" className="link-button welcome-skip" onClick={() => onChoose('look')}>
          Just look around first
        </button>
      </section>
    </div>
  );
}
