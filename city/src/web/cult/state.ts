import { useCallback, useEffect, useState } from 'react';
import { cultApi, type CultEvent, type CultSnapshot } from './api';

const EVENTS = ['phase_changed', 'debate', 'votes_cast', 'override', 'member_changed', 'control_changed', 'city_gap', 'city_late', 'schedule_gap', 'place_control_changed', 'cycle_resolved'];

/** Follow Cult only while its City panel is open. Reconnects retain the last committed state. */
export function useCult() {
  const [snapshot, setSnapshot] = useState<CultSnapshot | null>(null);
  const [feed, setFeed] = useState<CultEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState('Connecting…');
  const merge = useCallback((events: CultEvent[]) => setFeed(current => {
    const entries = new Map(current.map(event => [event.revision, event]));
    events.forEach(event => entries.set(event.revision, event));
    return [...entries.values()].sort((a, b) => BigInt(a.revision) < BigInt(b.revision) ? -1 : BigInt(a.revision) > BigInt(b.revision) ? 1 : 0).slice(-100);
  }), []);
  const refresh = useCallback(async () => {
    const next = await cultApi.snapshot();
    setSnapshot(next); merge(next.recentEvents); setError(null);
    return next;
  }, [merge]);

  useEffect(() => {
    let closed = false;
    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const failed = (cause: unknown) => {
      if (closed) return;
      setConnection('Reconnecting…');
      setError(cause instanceof Error ? cause.message : "Can't reach the Cult right now.");
    };
    const open = async () => {
      try {
        const first = await cultApi.snapshot();
        if (closed) return;
        setSnapshot(first); merge(first.recentEvents); setError(null);
        source = new EventSource(`/api/cult/events?after=${first.revision}`);
        source.addEventListener('open', () => { if (!closed) { setConnection('Live'); setError(null); } });
        source.addEventListener('error', () => { if (!closed) setConnection('Reconnecting… · showing last known state'); });
        for (const type of EVENTS) source.addEventListener(type, event => {
          if (closed) return;
          try { merge([JSON.parse((event as MessageEvent<string>).data) as CultEvent]); }
          catch (cause) { failed(cause); return; }
          clearTimeout(pending);
          pending = setTimeout(() => { if (!closed) void refresh().catch(failed); }, 250);
        });
        source.addEventListener('reset', () => {
          source?.close(); clearTimeout(pending); setConnection('Reconnecting…'); void open();
        });
      } catch (cause) {
        failed(cause);
        if (!closed) retry = setTimeout(() => { void open(); }, 3000);
      }
    };
    void open();
    return () => { closed = true; source?.close(); clearTimeout(retry); clearTimeout(pending); };
  }, [merge, refresh]);
  return { snapshot, feed, error, connection, refresh };
}
