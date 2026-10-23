// Hand-drawn SVG world pieces. Provisional art (Task 10 replaces it through the same props),
// but drawn to the art direction: ink linework, paper fills, a single purple for Chogs.
import type { HomeStyle, PlaceId, Resource } from '../../shared/contracts';

const INK = 'var(--ink)';

/** Per-resident scarf colours: earthy, distinct at 8px, all readable against purple. */
const SCARVES = ['#d9822b', '#3f7d6e', '#c4573e', '#e0b84a', '#4f6fa8', '#8a5a44', '#6b8f3a', '#b85c8a', '#2f7f9a', '#a3742c', '#5d6b2f', '#9c4d2f'];
export const scarfFor = (tokenId: string) => SCARVES[Number(BigInt(tokenId) % BigInt(SCARVES.length))]!;

// -------------------------------------------------------------------------------------------
// Chog: hedgehog-cat. Origin at the feet.

export function ChogFigure({ scarf, mood = 'idle' }: { scarf: string; mood?: 'idle' | 'sleep' | 'frozen' }) {
  const eyesClosed = mood === 'sleep';
  return (
    <g className="chog-figure" opacity={mood === 'frozen' ? 0.55 : 1}>
      <ellipse cx="0" cy="0.5" rx="8.5" ry="2.4" fill="rgba(42,33,27,0.18)" />
      {/* spikes along the back */}
      <path
        d="M-9 -7 L-12 -11 L-8 -12 L-9 -16 L-5 -15 L-4 -19 L0 -16.5 L3 -19.5 L5 -15.5 L9 -16.5 L8.5 -12 L12.5 -11 L9 -7 Z"
        fill="var(--chog-deep)"
        stroke={INK}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* ears */}
      <path d="M-7.5 -13 L-6.5 -20 L-2.5 -15 Z" fill="var(--chog)" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      <path d="M7.5 -13 L6.5 -20 L2.5 -15 Z" fill="var(--chog)" stroke={INK} strokeWidth="1" strokeLinejoin="round" />
      <path d="M-6.3 -14.5 L-5.9 -17.6 L-4 -15.3 Z" fill="#c9b8fa" />
      <path d="M6.3 -14.5 L5.9 -17.6 L4 -15.3 Z" fill="#c9b8fa" />
      {/* body */}
      <ellipse cx="0" cy="-8" rx="8.6" ry="8" fill="var(--chog)" stroke={INK} strokeWidth="1.1" />
      {/* face patch */}
      <ellipse cx="0" cy="-6.6" rx="5.6" ry="4.6" fill="#f1ecff" />
      {eyesClosed ? (
        <>
          <path d="M-3.6 -8.6 q1.1 1 2.2 0" stroke={INK} strokeWidth="0.9" fill="none" strokeLinecap="round" />
          <path d="M1.4 -8.6 q1.1 1 2.2 0" stroke={INK} strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="-2.5" cy="-8.4" r="1.35" fill={INK} />
          <circle cx="2.5" cy="-8.4" r="1.35" fill={INK} />
          <circle cx="-2.1" cy="-8.9" r="0.4" fill="#fff" />
          <circle cx="2.9" cy="-8.9" r="0.4" fill="#fff" />
        </>
      )}
      <path d="M-0.8 -6.2 q0.8 0.7 1.6 0" stroke={INK} strokeWidth="0.8" fill="none" strokeLinecap="round" />
      <circle cx="-4.4" cy="-6" r="0.9" fill="#f3b5c4" opacity="0.8" />
      <circle cx="4.4" cy="-6" r="0.9" fill="#f3b5c4" opacity="0.8" />
      {/* scarf */}
      <path d="M-6.4 -3.4 q6.4 2.6 12.8 0 l0.4 1.8 q-6.8 2.8 -13.6 0 Z" fill={scarf} stroke={INK} strokeWidth="0.7" />
      <path d="M3.6 -2.2 l1.6 3.4 l1.8 -0.6 l-1 -3.4 Z" fill={scarf} stroke={INK} strokeWidth="0.6" />
      {/* feet */}
      <ellipse cx="-3.6" cy="-0.4" rx="2.4" ry="1.3" fill="var(--chog-deep)" stroke={INK} strokeWidth="0.8" />
      <ellipse cx="3.6" cy="-0.4" rx="2.4" ry="1.3" fill="var(--chog-deep)" stroke={INK} strokeWidth="0.8" />
    </g>
  );
}

// -------------------------------------------------------------------------------------------
// Activity glyphs (12x12 around 0,0), shown in a bubble above a Chog and inline in the panel.

export type Glyph = Resource | 'build' | 'rest' | 'social' | 'paused' | 'frozen' | 'ruins' | 'home';

export function GlyphPath({ glyph }: { glyph: Glyph }) {
  const s = { stroke: INK, strokeWidth: 1.2, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (glyph) {
    case 'wood': // axe
      return (
        <g {...s}>
          <path d="M-3.5 4.5 L3 -2" strokeWidth="1.5" stroke="var(--wood)" />
          <path d="M1.2 -4.6 q3.6 -0.6 4 3 l-2.2 0.4 Z" fill="var(--stone-soft)" />
        </g>
      );
    case 'stone': // pick
      return (
        <g {...s}>
          <path d="M0 -1.5 L0 5" strokeWidth="1.5" stroke="var(--wood)" />
          <path d="M-5 -1.2 q5 -4.6 10 0" strokeWidth="1.6" />
        </g>
      );
    case 'food': // wheat
      return (
        <g {...s}>
          <path d="M0 5 L0 -4.5" stroke="var(--food)" strokeWidth="1.3" />
          <path d="M0 -3 q-2.6 -0.4 -2.8 -2.6 M0 -3 q2.6 -0.4 2.8 -2.6 M0 0 q-2.6 -0.4 -2.8 -2.6 M0 0 q2.6 -0.4 2.8 -2.6" stroke="var(--food)" />
        </g>
      );
    case 'build': // hammer
      return (
        <g {...s}>
          <path d="M-3.8 4.6 L1.6 -0.8" strokeWidth="1.5" stroke="var(--wood)" />
          <path d="M-0.4 -3.6 L3.6 0.4 L5.2 -1.2 L1.2 -5.2 Z" fill={INK} />
        </g>
      );
    case 'rest':
      return (
        <text x="0" y="3.6" textAnchor="middle" fontSize="9" fontFamily="var(--font-display)" fontStyle="italic" fill={INK}>
          z
        </text>
      );
    case 'social':
      return (
        <g fill={INK}>
          <circle cx="-3" cy="0" r="1.1" />
          <circle cx="0" cy="0" r="1.1" />
          <circle cx="3" cy="0" r="1.1" />
        </g>
      );
    case 'paused':
      return (
        <g fill={INK}>
          <rect x="-3" y="-3.5" width="2" height="7" rx="0.6" />
          <rect x="1" y="-3.5" width="2" height="7" rx="0.6" />
        </g>
      );
    case 'frozen': // broken link
      return (
        <g {...s}>
          <path d="M-1 -3 l-2 0 a2.6 2.6 0 0 0 0 5.2 l1.2 0" />
          <path d="M1 3 l2 0 a2.6 2.6 0 0 0 0 -5.2 l-1.2 0" />
        </g>
      );
    case 'ruins':
      return (
        <g {...s}>
          <path d="M-4.5 4 L-4.5 -2 L-2 -0.5 L0 -4 L1.5 -1 L4.5 -2.5 L4.5 4 Z" fill="var(--stone-soft)" />
        </g>
      );
    case 'home':
      return (
        <g {...s}>
          <path d="M-4.5 0 L0 -4.2 L4.5 0 M-3.2 -1 L-3.2 4 L3.2 4 L3.2 -1" />
        </g>
      );
  }
}

export function GlyphIcon({ glyph, size = 16, title }: { glyph: Glyph; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="-7 -7 14 14" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      <GlyphPath glyph={glyph} />
    </svg>
  );
}

// -------------------------------------------------------------------------------------------
// Homes. Origin at lot centre; lots are 54 units square.

export function Lot({ vacant }: { vacant: boolean }) {
  return (
    <g>
      <rect x="-27" y="-27" width="54" height="54" rx="7" fill="#d5dcae" stroke="var(--meadow-shade)" strokeWidth="1" />
      <rect x="-24" y="-24" width="48" height="48" rx="5" fill="none" stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="1.5 4" strokeLinecap="round" opacity="0.7" />
      {vacant ? (
        <g opacity="0.75">
          <path d="M0 10 L0 -2" stroke="var(--wood)" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="-9" y="-9" width="18" height="9" rx="1.5" fill="var(--paper-raised)" stroke={INK} strokeWidth="1" />
          <path d="M-5.5 -4.5 h11" stroke="var(--ink-3)" strokeWidth="1" strokeDasharray="2 1.5" />
        </g>
      ) : null}
    </g>
  );
}

/** Every occupied lot gets a mailbox in its resident's scarf colour; the flag is up while they're running. */
export function Mailbox({ flag, raised }: { flag: string; raised: boolean }) {
  return (
    <g transform="translate(-17 12)">
      <path d="M0 12 L0 1" stroke="var(--wood)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M-4.5 2 L-4.5 -2.5 a4.5 4.5 0 0 1 9 0 L4.5 2 Z" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1" />
      <path
        d={raised ? 'M4.5 -1 L4.5 -8.5 L8.5 -8.5 L8.5 -5.5 L5.5 -5.5' : 'M4.5 -1 L10 -1 L10 1.5 L4.5 1.5'}
        fill={flag}
        stroke="var(--ink)"
        strokeWidth="0.8"
        strokeLinejoin="round"
      />
    </g>
  );
}

function Cottage({ level }: { level: number }) {
  if (level >= 2) {
    return (
      <g>
        <rect x="9" y="-29" width="5" height="10" fill="#9a5a46" stroke={INK} strokeWidth="1" />
        <g className="smoke">
          <circle cx="11.5" cy="-33" r="2.2" fill="#fff" opacity="0.7" />
          <circle cx="13.5" cy="-38" r="2.8" fill="#fff" opacity="0.5" />
        </g>
        <rect x="-18" y="-11" width="36" height="26" rx="1.5" fill="#f3e5c9" stroke={INK} strokeWidth="1.3" />
        <path d="M-22 -10 L0 -30 L22 -10 Z" fill="var(--roof)" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M-14 -14 L0 -26.5 L14 -14" fill="none" stroke="#9e3f2b" strokeWidth="1" opacity="0.6" />
        <rect x="-4" y="3" width="8" height="12" rx="3.5" fill="var(--wood)" stroke={INK} strokeWidth="1" />
        <rect x="-14" y="-5" width="7" height="6" fill="#ffe7a0" stroke={INK} strokeWidth="1" />
        <rect x="7" y="-5" width="7" height="6" fill="#ffe7a0" stroke={INK} strokeWidth="1" />
        <path d="M-10.5 -5 v6 M10.5 -5 v6" stroke={INK} strokeWidth="0.7" />
      </g>
    );
  }
  return (
    <g>
      <rect x="-13" y="-6" width="26" height="20" rx="1.5" fill="#f3e5c9" stroke={INK} strokeWidth="1.3" />
      <path d="M-17 -5 L0 -21 L17 -5 Z" fill="var(--roof)" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="-3.5" y="4" width="7" height="10" rx="3" fill="var(--wood)" stroke={INK} strokeWidth="1" />
      <rect x="5" y="-1" width="5" height="5" fill="#ffe7a0" stroke={INK} strokeWidth="0.9" />
    </g>
  );
}

function Workshop({ level }: { level: number }) {
  const wide = level >= 2;
  const w = wide ? 38 : 28;
  return (
    <g>
      <rect x={-w / 2} y="-8" width={w} height="22" rx="1" fill="var(--stone-soft)" stroke={INK} strokeWidth="1.3" />
      <path
        d={wide ? 'M-21 -8 L-21 -18 L-9 -10 L-9 -20 L3 -12 L3 -22 L15 -14 L21 -14 L21 -8 Z' : 'M-16 -8 L-16 -17 L-4 -10 L-4 -19 L8 -12 L16 -12 L16 -8 Z'}
        fill="#6d7a86"
        stroke={INK}
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d={`M${-w / 2 + 2} 2 h${w - 4} M${-w / 2 + 2} 8 h${w - 4}`} stroke="var(--stone)" strokeWidth="0.8" opacity="0.7" />
      <rect x="-5" y="2" width="10" height="12" fill="var(--wood)" stroke={INK} strokeWidth="1" />
      <path d="M0 2 v12" stroke={INK} strokeWidth="0.7" />
      {wide ? (
        <g transform="translate(13 -1)">
          <circle r="4.6" fill="var(--food)" stroke={INK} strokeWidth="1" strokeDasharray="2 1.4" />
          <circle r="1.6" fill={INK} />
        </g>
      ) : null}
    </g>
  );
}

function Treehouse({ level }: { level: number }) {
  const big = level >= 2;
  return (
    <g>
      <path d="M-3.5 15 L-2.5 -4 L2.5 -4 L3.5 15 Z" fill="var(--wood)" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M-2 15 q-5 0 -7 2 M2 15 q5 0 7 2" stroke={INK} strokeWidth="1" fill="none" strokeLinecap="round" />
      <g fill="#6f8f4e" stroke={INK} strokeWidth="1.2">
        <circle cx={big ? -11 : -8} cy="-18" r={big ? 11 : 9} />
        <circle cx={big ? 11 : 8} cy="-18" r={big ? 11 : 9} />
        <circle cx="0" cy={big ? -27 : -24} r={big ? 13 : 10} />
      </g>
      <g fill="#86a862" opacity="0.9">
        <circle cx={big ? -8 : -6} cy="-21" r="3" />
        <circle cx="3" cy={big ? -31 : -27} r="3.5" />
      </g>
      <rect x={big ? -10 : -7} y={big ? -16 : -14} width={big ? 20 : 14} height={big ? 12 : 9} fill="#e8cfa4" stroke={INK} strokeWidth="1.1" />
      <path d={big ? 'M-12.5 -16 L0 -24 L12.5 -16 Z' : 'M-9 -14 L0 -20 L9 -14 Z'} fill="var(--roof)" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <rect x="-2" y={big ? -12 : -11} width="4" height={big ? 8 : 6} fill="var(--wood)" stroke={INK} strokeWidth="0.8" />
      {big ? <path d="M6 -4 L8 15 M10 -4 L12 15 M6.6 2 h4 M7.3 8 h4" stroke={INK} strokeWidth="0.9" /> : null}
    </g>
  );
}

export function Home({ style, level }: { style: HomeStyle; level: number }) {
  if (level <= 0) return null;
  if (style === 'workshop') return <Workshop level={level} />;
  if (style === 'treehouse') return <Treehouse level={level} />;
  return <Cottage level={level} />;
}

/** Scaffolding drawn over the lot; `progress` 0..1 raises the frame. */
export function Scaffold({ progress }: { progress: number }) {
  const h = 8 + Math.round(progress * 18);
  return (
    <g>
      <rect x="-14" y={12 - h} width="28" height={h} fill="#f3e5c9" opacity="0.55" stroke="none" />
      <g stroke="var(--wood)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M-15 14 L-15 -18 M15 14 L15 -18 M0 14 L0 -18" />
        <path d="M-15 4 L15 4 M-15 -7 L15 -7" />
      </g>
      <path d="M-15 4 L0 -7 M0 4 L15 -7" stroke="var(--wood)" strokeWidth="1" opacity="0.7" />
      <path d="M15 -18 l0 -6 l7 2.6 l-7 2.6" fill="var(--chog)" stroke={INK} strokeWidth="0.8" />
    </g>
  );
}

export function Ruins() {
  return (
    <g opacity="0.8">
      <path d="M-15 14 L-15 -4 L-9 -9 L-6 -1 L-1 -6 L-1 14 Z" fill="var(--stone-soft)" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M4 14 L4 -2 L9 1 L13 -5 L15 14 Z" fill="var(--stone-soft)" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <g fill="var(--stone)" stroke={INK} strokeWidth="0.7">
        <circle cx="-4" cy="13" r="2" />
        <circle cx="1" cy="12" r="1.4" />
        <circle cx="18" cy="12" r="1.6" />
      </g>
    </g>
  );
}

// -------------------------------------------------------------------------------------------
// Places. Origin at the place anchor.

function Pine({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-1.6 8 L-1.6 13 L1.6 13 L1.6 8 Z" fill="var(--wood)" stroke={INK} strokeWidth="0.9" />
      <path d="M0 -15 L-9 2 L-5 2 L-11 10 L11 10 L5 2 L9 2 Z" fill="#4f7a4a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M0 -10 L-3 -3 M2 0 L5 5" stroke="#6f9b63" strokeWidth="1" strokeLinecap="round" />
    </g>
  );
}

function Rock({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path d="M-11 6 L-8 -4 L-1 -9 L8 -6 L12 6 Z" fill="#a9b3b9" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M-1 -9 L1 6 M-8 -4 L-3 1" stroke="var(--stone)" strokeWidth="0.9" />
    </g>
  );
}

export function PlaceArt({ id }: { id: PlaceId }) {
  switch (id) {
    case 'forest':
      return (
        <g>
          <Pine x={-14} y={-20} s={1.1} />
          <Pine x={14} y={-24} s={1.25} />
          <Pine x={0} y={-8} s={1.35} />
          <Pine x={-22} y={2} s={0.95} />
          <Pine x={22} y={0} s={1} />
          <g transform="translate(-4 14)">
            <ellipse rx="7" ry="3" fill="#c79566" stroke={INK} strokeWidth="1" />
            <ellipse rx="3.6" ry="1.4" fill="#e5c39a" />
          </g>
        </g>
      );
    case 'quarry':
      return (
        <g>
          <path d="M-30 12 Q-26 -22 0 -26 Q26 -22 30 12 Z" fill="#c7c0b2" stroke={INK} strokeWidth="1.2" />
          <path d="M-20 12 Q-16 -10 0 -13 Q16 -10 20 12" fill="#b4ab9a" stroke={INK} strokeWidth="0.9" />
          <Rock x={-14} y={4} s={0.9} />
          <Rock x={12} y={2} s={1.1} />
          <g transform="translate(-2 8)">
            <rect x="-6" y="-3" width="12" height="6" rx="1" fill="var(--wood)" stroke={INK} strokeWidth="0.9" />
            <circle cx="-3.5" cy="4" r="1.6" fill={INK} />
            <circle cx="3.5" cy="4" r="1.6" fill={INK} />
          </g>
        </g>
      );
    case 'farm':
      return (
        <g>
          <path d="M-32 14 L-26 -18 L28 -18 L32 14 Z" fill="#d9b672" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
          {[-12, -4, 4, 12].map((y) => (
            <path key={y} d={`M${-28 + (y + 18) * 0.18} ${y} L${28 + (y + 18) * 0.12} ${y}`} stroke="#8f7a2c" strokeWidth="1.4" strokeDasharray="3 2.4" strokeLinecap="round" />
          ))}
          <g transform="translate(24 -22)">
            <path d="M0 0 L0 -12" stroke="var(--wood)" strokeWidth="1.4" />
            <path d="M-6 -9 L6 -9" stroke="var(--wood)" strokeWidth="1.4" />
            <circle cy="-14" r="3" fill="#e0b84a" stroke={INK} strokeWidth="0.9" />
          </g>
        </g>
      );
    case 'plaza':
      return (
        <g>
          <ellipse rx="34" ry="20" fill="#e9dcc1" stroke={INK} strokeWidth="1.2" />
          <ellipse rx="34" ry="20" fill="none" stroke="var(--path-edge)" strokeWidth="1" strokeDasharray="4 4" transform="scale(0.78)" />
          <g transform="translate(0 -6)">
            <path d="M0 6 L0 -16" stroke={INK} strokeWidth="2" strokeLinecap="round" />
            <path d="M-5 -16 L5 -16 L3.5 -24 L-3.5 -24 Z" fill="#ffd77a" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
            <path d="M-4.5 -24 L0 -28 L4.5 -24" fill={INK} stroke={INK} strokeWidth="1" />
            <circle cy="-20" r="9" fill="#ffd77a" opacity="0.25" className="lantern-glow" />
          </g>
        </g>
      );
    case 'tavern':
      return (
        <g>
          <rect x="-24" y="-16" width="48" height="28" rx="1.5" fill="#e8cfa4" stroke={INK} strokeWidth="1.3" />
          <path d="M-28 -15 L-18 -32 L18 -32 L28 -15 Z" fill="#5f6e4a" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M-24 -4 h48" stroke="var(--wood)" strokeWidth="1.4" />
          <rect x="-5" y="-1" width="10" height="13" rx="4.5" fill="var(--wood)" stroke={INK} strokeWidth="1" />
          <rect x="-19" y="-10" width="8" height="6" fill="#ffd77a" stroke={INK} strokeWidth="0.9" />
          <rect x="11" y="-10" width="8" height="6" fill="#ffd77a" stroke={INK} strokeWidth="0.9" />
          <g transform="translate(30 -10)">
            <path d="M-4 0 h8" stroke={INK} strokeWidth="1.2" />
            <rect x="-4" y="1.5" width="8" height="7" rx="1" fill="var(--paper-raised)" stroke={INK} strokeWidth="0.9" />
            <path d="M-2 5 q2 -2.2 4 0" stroke="var(--ok)" strokeWidth="1" fill="none" />
          </g>
        </g>
      );
    case 'workshop':
      return (
        <g>
          <rect x="-24" y="-14" width="48" height="26" rx="1" fill="var(--stone-soft)" stroke={INK} strokeWidth="1.3" />
          <path d="M-27 -14 L-27 -26 L-13 -18 L-13 -30 L1 -22 L1 -32 L15 -24 L27 -24 L27 -14 Z" fill="#6d7a86" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" />
          <rect x="-8" y="-2" width="16" height="14" fill="var(--wood)" stroke={INK} strokeWidth="1" />
          <path d="M0 -2 v14" stroke={INK} strokeWidth="0.8" />
          <g transform="translate(-16 -5)">
            <circle r="5" fill="var(--food)" stroke={INK} strokeWidth="1" strokeDasharray="2.2 1.4" />
            <circle r="1.7" fill={INK} />
          </g>
        </g>
      );
  }
}
