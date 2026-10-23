// Small hand-drawn icons for the Chog card: section tabs, needs, and the four decorations.
// Same ink-outline style as the map glyphs, sized for 20-48px.
import type { DecorId, Need } from '../../shared/contracts';

const INK = 'var(--ink)';
const line = { stroke: INK, strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export type SheetSection = 'life' | 'home' | 'market' | 'council' | 'soul' | 'settings';

export function SectionIcon({ section }: { section: SheetSection }) {
  return (
    <svg width="20" height="20" viewBox="-10 -10 20 20" aria-hidden="true">
      {section === 'life' ? (
        <path d="M0 6.5 C-7 1.8 -8 -2 -6.2 -4.6 C-4.4 -7 -1.4 -6.4 0 -3.8 C1.4 -6.4 4.4 -7 6.2 -4.6 C8 -2 7 1.8 0 6.5 Z" {...line} fill="var(--section-fill, none)" />
      ) : null}
      {section === 'home' ? (
        <g {...line} fill="none">
          <path d="M-7 -0.5 L0 -7 L7 -0.5" fill="var(--section-fill, none)" />
          <path d="M-5 -2 V6.5 H5 V-2" />
          <path d="M-1.6 6.5 V2 H1.6 V6.5" />
        </g>
      ) : null}
      {section === 'market' ? (
        <g {...line}>
          <circle r="6.6" fill="var(--section-fill, none)" />
          <path d="M2.2 -2.6 C1.4 -3.6 -2.6 -3.8 -2.6 -1.4 C-2.6 1 2.6 -0.4 2.6 2 C2.6 4 -1.6 4 -2.6 2.6 M0 -5 V-3.6 M0 3.8 V5" />
        </g>
      ) : null}
      {section === 'council' ? (
        <g {...line}>
          <path d="M-7 -3.5 H7 L5 6.5 H-5 Z" fill="var(--section-fill, none)" />
          <path d="M-4.5 -3.5 C-4.5 -7.2 4.5 -7.2 4.5 -3.5" />
          <path d="M-2 1 H2" />
        </g>
      ) : null}
      {section === 'soul' ? (
        <g {...line}>
          <path d="M0 -7.5 L1.7 -1.7 L7.5 0 L1.7 1.7 L0 7.5 L-1.7 1.7 L-7.5 0 L-1.7 -1.7 Z" fill="var(--section-fill, none)" />
        </g>
      ) : null}
      {section === 'settings' ? (
        <g {...line}>
          <path d="M-7 -4 H7 M-7 0 H7 M-7 4 H7" />
          <circle cx="-3" cy="-4" r="1.8" fill="var(--paper-raised)" />
          <circle cx="3.2" cy="0" r="1.8" fill="var(--paper-raised)" />
          <circle cx="-1" cy="4" r="1.8" fill="var(--paper-raised)" />
        </g>
      ) : null}
    </svg>
  );
}

export function NeedIcon({ need }: { need: Need }) {
  return (
    <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
      {need === 'energy' ? <path d="M1.5 -7 L-4.5 1 H0 L-1.5 7 L4.5 -1 H0 Z" {...line} fill="#f3d36b" /> : null}
      {need === 'hunger' ? (
        <g {...line}>
          <path d="M0 -3.4 C-3.8 -6 -7 -2.6 -5.6 1.6 C-4.6 5 -2 6.6 0 5.2 C2 6.6 4.6 5 5.6 1.6 C7 -2.6 3.8 -6 0 -3.4 Z" fill="#e9826a" />
          <path d="M0 -3.4 C0 -5 0.8 -6.4 2.4 -7" />
        </g>
      ) : null}
      {need === 'fun' ? <path d="M0 -7 L2 -2.4 L7 -2 L3.2 1.4 L4.3 6.4 L0 3.8 L-4.3 6.4 L-3.2 1.4 L-7 -2 L-2 -2.4 Z" {...line} fill="#f0c22e" /> : null}
      {need === 'social' ? (
        <g {...line}>
          <path d="M-6.5 -4.8 H4.5 V2.4 H-1 L-4 5.4 V2.4 H-6.5 Z" fill="#a9c7f0" />
          <path d="M-3.6 -1.2 H1.6" />
        </g>
      ) : null}
    </svg>
  );
}

/** A little drawing of each decoration, for the Home tab's shop. */
export function DecorArt({ item, size = 44 }: { item: DecorId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-20 -22 40 40" aria-hidden="true">
      <ellipse cx="0" cy="14" rx="14" ry="3" fill="rgba(42,33,27,0.12)" />
      {item === 'lantern' ? (
        <g {...line}>
          <path d="M0 14 V-6" strokeWidth="1.8" />
          <path d="M-4 -6 H4 L3 -16 H-3 Z" fill="#ffe08a" />
          <path d="M-5 -16 H5 L0 -20 Z" fill="var(--roof)" />
          <circle cx="0" cy="-11" r="1.6" fill="#f29b2f" stroke="none" />
        </g>
      ) : null}
      {item === 'flowerbed' ? (
        <g {...line}>
          <path d="M-13 14 Q-13 6 0 6 Q13 6 13 14 Z" fill="#9c6b45" />
          {[-8, 0, 8].map((x, i) => (
            <g key={x}>
              <path d={`M${x} 7 V-2`} stroke="#4f8a4a" />
              <circle cx={x} cy={-4} r="3.4" fill={['#ee8db6', '#f0c22e', '#a98ce8'][i]} />
              <circle cx={x} cy={-4} r="1" fill="#fff6d8" stroke="none" />
            </g>
          ))}
        </g>
      ) : null}
      {item === 'bench' ? (
        <g {...line}>
          <rect x="-14" y="-6" width="28" height="5" rx="1.5" fill="var(--wood)" />
          <rect x="-14" y="1" width="28" height="4" rx="1.5" fill="#c58a57" />
          <path d="M-11 5 V14 M11 5 V14" strokeWidth="2" />
        </g>
      ) : null}
      {item === 'well' ? (
        <g {...line}>
          <path d="M-11 -2 H11 V12 Q0 16 -11 12 Z" fill="var(--stone-soft)" />
          <path d="M-11 3 H11 M-4 -2 V3 M4 3 V9 M-6 9 V12" stroke="var(--stone)" />
          <path d="M-9 -2 V-14 M9 -2 V-14" strokeWidth="1.8" />
          <path d="M-13 -13 L0 -20 L13 -13 Z" fill="var(--roof)" />
          <path d="M0 -13 V-5" />
          <rect x="-2.4" y="-6" width="4.8" height="4" rx="1" fill="var(--wood)" />
        </g>
      ) : null}
    </svg>
  );
}
