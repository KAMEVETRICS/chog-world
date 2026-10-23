// Who rules each of the three places Chog Cult fights over, read from the Cult API on the same server
// (docs/superpowers/specs/2026-10-19-cult-city-contract.md, section 2). City only reads; it never writes to Cult.
import { useEffect, useState } from 'react';
import type { PlaceId } from '../../shared/contracts';

export type FactionId = 'crown' | 'chaos';

/** One place from `GET /api/cult/places`. Decree text comes from Cult: React escapes it like any other text. */
export interface PlaceRule {
  place: 'plaza' | 'tavern' | 'workshop';
  ruler: FactionId | null;
  sinceCycle: number | null;
  decree: { id: string; title: string; banner: string; feedLine: string } | null;
}

export interface Rulers {
  cycle: number;
  places: Partial<Record<PlaceId, PlaceRule>>;
  /** The last answer is shown while Cult can't be reached, marked as possibly out of date. */
  stale: boolean;
}

export const RULED_PLACES = ['plaza', 'tavern', 'workshop'] as const satisfies readonly PlaceId[];
export const FACTION_NAME: Record<FactionId, string> = { crown: 'The Crown', chaos: 'The Chaos' };
export const FACTION_SHORT: Record<FactionId, string> = { crown: 'Crown', chaos: 'Chaos' };

/**
 * Loads the rulers, then follows Cult's event stream and reloads on every `place_control_changed` (the
 * simplest correct approach in the contract). `enabled` is false in the fixture village, which has no Cult.
 */
export function useCultRulers(enabled: boolean, EventSourceImpl: typeof EventSource = globalThis.EventSource): Rulers | null {
  const [rulers, setRulers] = useState<Rulers | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    const markStale = () => setRulers((current) => (current ? { ...current, stale: true } : current));
    const load = async () => {
      try {
        const response = await fetch('/api/cult/places', { credentials: 'same-origin' });
        if (!response.ok) throw new Error(`Cult answered ${response.status}`);
        const body = (await response.json()) as { cycle: number; places: PlaceRule[] };
        if (!closed) setRulers({ cycle: body.cycle, places: Object.fromEntries(body.places.map((rule) => [rule.place, rule])), stale: false });
      } catch {
        if (!closed) markStale();
      }
    };
    // Each (re)connection reloads, so a change missed while disconnected is never kept.
    const source = new EventSourceImpl('/api/cult/events');
    source.addEventListener('open', () => void load());
    source.addEventListener('place_control_changed', () => void load());
    source.addEventListener('reset', () => void load());
    source.addEventListener('error', markStale);
    void load();
    return () => {
      closed = true;
      source.close();
    };
  }, [enabled, EventSourceImpl]);

  return rulers;
}
