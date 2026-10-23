import { useCallback, useEffect, useRef, useState } from "react";
import { EVENT_TYPES, api, type EventDto, type SnapshotDto } from "./api";

export type Connection = "connecting" | "live" | "reconnecting";
const FEED_LIMIT = 200;

/**
 * Loads the snapshot, then follows the event stream from its revision. Each event is added to the feed
 * and triggers a debounced snapshot reload, so every panel shows committed server state only.
 */
export function useCult() {
  const [snapshot, setSnapshot] = useState<SnapshotDto | null>(null);
  const [feed, setFeed] = useState<EventDto[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await api.snapshot();
      setSnapshot(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the council.");
      return null;
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { void refresh(); }, 250);
  }, [refresh]);

  useEffect(() => {
    let source: EventSource | undefined;
    let stopped = false;
    const merge = (events: readonly EventDto[]) => setFeed((current) => {
      const byRevision = new Map(current.map((event) => [event.revision, event]));
      for (const event of events) byRevision.set(event.revision, event);
      return [...byRevision.values()].sort((a, b) => Number(BigInt(a.revision) - BigInt(b.revision))).slice(-FEED_LIMIT);
    });
    const open = async () => {
      const first = await refresh();
      if (stopped || !first) { if (!stopped) setTimeout(() => { void open(); }, 3000); return; }
      merge(first.recentEvents);
      source = new EventSource(`/api/cult/events?after=${first.revision}`);
      source.onopen = () => setConnection("live");
      source.onerror = () => setConnection("reconnecting");
      for (const type of EVENT_TYPES) {
        source.addEventListener(type, (message) => {
          merge([JSON.parse((message as MessageEvent<string>).data) as EventDto]);
          scheduleRefresh();
        });
      }
      // The cursor fell outside the replay window: start over from a fresh snapshot.
      source.addEventListener("reset", () => {
        source?.close();
        setConnection("reconnecting");
        void open();
      });
    };
    void open();
    return () => { stopped = true; source?.close(); clearTimeout(refreshTimer.current); };
  }, [refresh, scheduleRefresh]);

  return { snapshot, feed, connection, error, refresh };
}

/** Current time, updated every second, for countdowns. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
