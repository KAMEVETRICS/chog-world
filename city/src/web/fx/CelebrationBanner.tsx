// The banner for a big moment: drops in at the top of the visible world, stays a few seconds, and goes.
// One at a time; a click (or the next moment) moves it along. Announced politely to screen readers.
import { useEffect } from 'react';
import type { Celebration } from './celebrations';
import { setMuted, useMuted } from './sound';
import './fx.css';

const SHOW_MS = 4800;

function Emblem({ kind }: { kind: NonNullable<Celebration['banner']>['kind'] }) {
  if (kind === 'home') {
    return (
      <svg viewBox="-10 -10 20 20" width="26" height="26" aria-hidden="true">
        <path d="M-7 -0.5 L0 -7 L7 -0.5" fill="var(--roof)" stroke="var(--ink)" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M-5 -1.5 V6.5 H5 V-1.5" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M-1.4 6.5 V2.4 H1.4 V6.5" fill="var(--wood)" stroke="var(--ink)" strokeWidth="1" />
      </svg>
    );
  }
  if (kind === 'project') {
    return (
      <svg viewBox="-10 -10 20 20" width="26" height="26" aria-hidden="true">
        <path d="M-7 5 H7 L5.5 -0.5 H-5.5 Z" fill="var(--stone-soft)" stroke="var(--ink)" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M0 -0.5 V-5 M-3 -6 Q0 -9 3 -6" fill="none" stroke="#3fb5de" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  // rank and title: a star
  return (
    <svg viewBox="-10 -10 20 20" width="26" height="26" aria-hidden="true">
      <path d="M0 -8 L2.4 -2.7 L8 -2.3 L3.7 1.5 L5 7 L0 4.1 L-5 7 L-3.7 1.5 L-8 -2.3 L-2.4 -2.7 Z" fill="#f0c22e" stroke="var(--ink)" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

export function CelebrationBanner({ moment, onDone }: { moment: Celebration; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, SHOW_MS);
    return () => window.clearTimeout(id);
  }, [moment.id, onDone]);
  const banner = moment.banner!;
  return (
    <div className="hud celebration" role="status" aria-live="polite">
      <button type="button" key={moment.id} className={`celebration-card celebration-card--${banner.kind}`} onClick={onDone} aria-label={`${banner.title}. ${banner.detail} Dismiss.`}>
        <span className="celebration-emblem">
          <Emblem kind={banner.kind} />
        </span>
        <span className="celebration-text">
          <span className="celebration-title">{banner.title}</span>
          <span className="celebration-detail">{banner.detail}</span>
        </span>
      </button>
    </div>
  );
}

/** Sound on/off, by the clock. */
export function SoundToggle() {
  const muted = useMuted();
  return (
    <button
      type="button"
      className="sound-toggle"
      aria-pressed={!muted}
      aria-label={muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'}
      title={muted ? 'Sound off' : 'Sound on'}
      onClick={() => setMuted(!muted)}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M3 8 H6 L10.5 4.5 V15.5 L6 12 H3 Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        {muted ? (
          <path d="M13.5 7.5 L18 12 M18 7.5 L13.5 12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        ) : (
          <path d="M13.5 7 Q15.6 10 13.5 13 M15.6 5 Q19.2 10 15.6 15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}
