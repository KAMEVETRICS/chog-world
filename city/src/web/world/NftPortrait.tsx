// A Chog's portrait: its real NFT image when a gateway delivers it, otherwise a drawing of its own traits,
// never a generic stand-in. The drawing shows at once and the image fades in over it when it arrives.
import { useState } from 'react';
import { imageSources } from '../../fixtures/chog-genesis';
import type { Appearance } from '../../shared/looks';
import { AppearanceBadge } from './Badge';
import './badge.css';

export function NftPortrait({ image, appearance, size, alt }: { image: string | null | undefined; appearance: Appearance; size: number; alt: string }) {
  const sources = image ? imageSources(image) : [];
  const [state, setState] = useState<{ for: string | null; at: number; loaded: boolean }>({ for: image ?? null, at: 0, loaded: false });
  // A different Chog: start again from its first source.
  const current = state.for === (image ?? null) ? state : { for: image ?? null, at: 0, loaded: false };
  const src = sources[current.at];
  return (
    <span className="nft-portrait" style={{ width: size, height: size, background: appearance.background }}>
      <span className="nft-portrait-drawing" aria-hidden={src ? true : undefined}>
        <AppearanceBadge appearance={appearance} size={size * 0.86} {...(src ? {} : { label: alt })} />
      </span>
      {src ? (
        <img
          key={src}
          src={src}
          alt={alt}
          width={size}
          height={size}
          loading="lazy"
          className={current.loaded ? 'is-loaded' : undefined}
          onLoad={() => setState({ ...current, loaded: true })}
          onError={() => setState({ ...current, at: current.at + 1, loaded: false })}
        />
      ) : null}
    </span>
  );
}
