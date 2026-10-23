// React binding for any CityClient (fixture now, HTTP in Task 8). The UI only ever renders
// committed snapshots; every event triggers a refresh rather than local prediction.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentState, CityClient, CitySnapshot } from '../../shared/contracts';

export type { CityClient } from '../../shared/contracts';

export function useCity(client: CityClient) {
  const [snapshot, setSnapshot] = useState<CitySnapshot | null>(null);
  const [mine, setMine] = useState<AgentState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const [next, owned] = await Promise.all([client.getSnapshot(), client.getMyAgents()]);
      if (request !== latest.current) return; // a newer refresh already landed
      setSnapshot(next);
      setMine(owned);
      setError(null);
    } catch {
      setError("Can't reach the village right now. Showing the last known state.");
    }
  }, [client]);

  useEffect(() => {
    let unsubscribe = () => {};
    let cancelled = false;
    void client.getSnapshot().then((first) => {
      if (cancelled) return;
      void refresh();
      unsubscribe = client.subscribe(first.revision, () => void refresh(), () => void refresh());
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, refresh]);

  return { snapshot, mine, error, refresh };
}
