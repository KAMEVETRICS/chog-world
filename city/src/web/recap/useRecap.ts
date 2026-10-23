// Keeps this browser's snapshot of the world fresh while the page is open, and offers a recap on the
// way back in: on load, or on returning to a tab left in the background. Browser storage only; a blocked
// or cleared store just means no recap this time.
import { useEffect, useRef, useState } from 'react';
import type { AgentState, CitizenState, WorldState } from '../../shared/contracts';
import { capture, recapOf, type Recap, type Seen } from './recap';

const keyOf = (cityId: string, who: string) => `chog-city:seen:v1:${cityId}:${who}`;

/** The demo village restarts on every page load, so its snapshots live only as long as the page. */
const thisPageOnly = new Map<string, Seen>();
let persistent = true;

function load(key: string): Seen | null {
  if (!persistent) return thisPageOnly.get(key) ?? null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}

function save(key: string, seen: Seen) {
  if (!persistent) {
    thisPageOnly.set(key, seen);
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(seen));
  } catch {
    // Storage blocked or full: no recap next time, nothing else lost.
  }
}

/**
 * The player's Chogs and villager, read from the world itself. (A separately fetched "my Chogs" list can lag
 * a sign-in or player switch by a moment, and a recap built in that gap would report every Chog as sold.)
 */
function holdings(world: WorldState, who: string | null): { chogs: AgentState[]; citizen: CitizenState | null } {
  if (!who) return { chogs: [], citizen: null };
  const me = who.toLowerCase();
  return {
    chogs: world.agents.filter((a) => a.control.kind === 'controlled' && a.control.controller?.toLowerCase() === me),
    citizen: world.citizens.find((c) => c.address.toLowerCase() === me) ?? null,
  };
}

export function useRecap({
  world,
  who,
  enabled,
  persist,
}: {
  world: WorldState | undefined;
  /** The player's address, or null for a visitor. */
  who: string | null;
  enabled: boolean;
  /** False for the demo village: remember only within this page. */
  persist: boolean;
}): { recap: Recap | null; dismiss: () => void; stepAway: (pass: () => void) => void } {
  persistent = persist;
  const [recap, setRecap] = useState<Recap | null>(null);
  const checked = useRef<string | null>(null);
  /** The snapshot from just before the tab went into the background. */
  const atHide = useRef<Seen | null>(null);
  /** Set by `stepAway`: the snapshot to compare with once the skipped time has landed. */
  const leftAt = useRef<Seen | null>(null);
  const latest = useRef({ world, who });
  latest.current = { world, who };
  const key = world ? keyOf(world.cityId, who ?? 'visitor') : null;

  // Arriving (or switching player): compare with what this player last saw, then start remembering.
  useEffect(() => {
    if (!enabled || !world || !key) return;
    const { chogs, citizen } = holdings(world, who);
    if (leftAt.current && leftAt.current.tick !== world.tick) {
      const found = recapOf(leftAt.current, world, chogs, citizen);
      leftAt.current = null;
      if (found) setRecap(found);
    }
    if (checked.current !== key) {
      checked.current = key;
      const seen = load(key);
      setRecap(seen ? recapOf(seen, world, chogs, citizen) : null);
    }
    if (!document.hidden) save(key, capture(world, chogs, citizen));
  }, [enabled, key, world, who]);

  // Coming back to a tab left open in the background.
  useEffect(() => {
    if (!enabled || !key) return;
    const onVisibility = () => {
      const { world: w, who: me } = latest.current;
      if (!w) return;
      const { chogs: c, citizen: v } = holdings(w, me);
      if (document.hidden) {
        atHide.current = capture(w, c, v);
        return;
      }
      const seen = atHide.current;
      atHide.current = null;
      const found = seen ? recapOf(seen, w, c, v) : null;
      if (found) setRecap(found);
      save(key, capture(w, c, v));
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [enabled, key]);

  /** Demo: remember now, let `pass` move time on (skip a day), then show what happened meanwhile. */
  const stepAway = (pass: () => void) => {
    const { world: w, who: me } = latest.current;
    if (!w) return;
    const { chogs, citizen } = holdings(w, me);
    leftAt.current = capture(w, chogs, citizen);
    pass();
  };

  return { recap, dismiss: () => setRecap(null), stepAway };
}
