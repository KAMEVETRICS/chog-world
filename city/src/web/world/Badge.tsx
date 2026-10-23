// Flat 2D portraits drawn from appearance traits: used wherever an NFT image is missing or still loading.
import type { Appearance } from '../../shared/looks';

/** A small flat portrait of a Chog or villager in its own colours: fur, mask, outfit, eyes and hat. */
export function AppearanceBadge({ appearance: a, size = 56, label }: { appearance: Appearance; size?: number; label?: string }) {
  return (
    <svg viewBox="-16 -26 32 30" width={size} height={size * 0.94} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
      <ellipse cx="0" cy="2" rx="9" ry="2.2" fill="rgba(42,33,27,0.18)" />
      <path d="M-9 -7 L-12 -11 L-8 -12 L-9 -16 L-5 -15 L-4 -19 L0 -16.5 L3 -19.5 L5 -15.5 L9 -16.5 L8.5 -12 L12.5 -11 L9 -7 Z" fill={a.skin.furDeep} />
      <rect x="-7" y="-4" width="14" height="6" rx="3" fill={a.outfit.kind === 'none' ? a.skin.fur : a.outfit.color} />
      <ellipse cx="0" cy="-8" rx="8.6" ry="8" fill={a.skin.fur} />
      <ellipse cx="0" cy="-6.8" rx="6" ry="4.8" fill={a.skin.mask} />
      {a.eyes.kind === 'glasses' ? (
        <g fill="none" stroke="#2b2733" strokeWidth="1">
          <circle cx="-2.6" cy="-8" r="2" />
          <circle cx="2.6" cy="-8" r="2" />
        </g>
      ) : null}
      {a.eyes.kind === 'happy' ? (
        <g fill="none" stroke="#2b2733" strokeWidth="1.2" strokeLinecap="round">
          <path d="M-4 -7.6 Q-2.5 -9.4 -1 -7.6" />
          <path d="M1 -7.6 Q2.5 -9.4 4 -7.6" />
        </g>
      ) : (
        <g fill="#2b2733">
          <circle cx="-2.5" cy="-8" r="1.3" />
          <circle cx="2.5" cy="-8" r="1.3" />
        </g>
      )}
      {a.hat.kind !== 'none' ? <path d="M-7 -14 Q0 -22 7 -14 Z" fill={a.hat.color} /> : null}
    </svg>
  );
}
