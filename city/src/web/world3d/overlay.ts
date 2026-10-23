// A stable DOM container for drei <Html> overlays. Without it, Html attaches to the canvas
// parent first and re-attaches once R3F's event layer connects, remounting every label.
import { createContext, useContext } from 'react';

export const OverlayContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export function useOverlayPortal() {
  const ref = useContext(OverlayContext);
  return ref ? { portal: ref as React.RefObject<HTMLElement> } : {};
}
