// What this browser remembers about the player's goals: the welcome was shown, panels they opened,
// goals finished today and their streak of finished days. Per-viewer convenience only: the world never
// depends on it, and a private window that blocks storage just starts fresh.
import { useCallback, useMemo, useState } from 'react';
import type { Seen } from './goals';

interface ScopeRecord {
  seen: Seen[];
  done: string[];
}

interface GuideRecord {
  /** Keyed by 'first' or a village day number. Only the latest few are kept. */
  scopes: Record<string, ScopeRecord>;
  /** The last day all goals were finished, and how many days in a row that has happened. */
  streak: { day: number; count: number } | null;
}

const KEEP_SCOPES = 4;
const empty = (): GuideRecord => ({ scopes: {}, streak: null });

function read(key: string): GuideRecord {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return empty();
    const parsed = JSON.parse(raw) as Partial<GuideRecord>;
    return { scopes: parsed.scopes ?? {}, streak: parsed.streak ?? null };
  } catch {
    return empty();
  }
}

function write(key: string, record: GuideRecord) {
  const scopes = Object.keys(record.scopes)
    .sort((a, b) => (a === 'first' ? -1 : b === 'first' ? 1 : Number(b) - Number(a)))
    .slice(0, KEEP_SCOPES + 1);
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...record, scopes: Object.fromEntries(scopes.map((s) => [s, record.scopes[s]])) }));
  } catch {
    // Storage blocked or full: the goals still work for this visit.
  }
}

/** The welcome is per browser, not per player: whoever opens the page first time sees it once. */
const WELCOME_KEY = 'chog-city:welcomed';

export function useWelcomed(): [boolean, () => void] {
  const [welcomed, setWelcomed] = useState(() => {
    try {
      return window.localStorage.getItem(WELCOME_KEY) === '1';
    } catch {
      return false;
    }
  });
  const done = useCallback(() => {
    setWelcomed(true);
    try {
      window.localStorage.setItem(WELCOME_KEY, '1');
    } catch {
      // Shown again next visit; harmless.
    }
  }, []);
  return [welcomed, done];
}

export interface GuideMemory {
  seen: ReadonlySet<Seen>;
  doneBefore: ReadonlySet<string>;
  streak: number;
  markSeen: (signal: Seen) => void;
  /** Records finished goals; when every goal of a day is finished, the streak grows. */
  markDone: (ids: readonly string[], allDone: boolean) => void;
}

/** Goal memory for one player in one city, for the given scope ('first' or a village day). */
export function useGuideMemory(cityId: string, who: string, scope: 'first' | number): GuideMemory {
  const key = `chog-city:guide:v1:${cityId}:${who}`;
  const [record, setRecord] = useState<{ key: string; value: GuideRecord }>(() => ({ key, value: read(key) }));
  const current = record.key === key ? record.value : read(key);
  if (record.key !== key) setRecord({ key, value: current });

  const update = useCallback(
    (change: (r: GuideRecord) => GuideRecord | null) => {
      setRecord((prev) => {
        const base = prev.key === key ? prev.value : read(key);
        const next = change(base);
        if (!next) return prev.key === key ? prev : { key, value: base };
        write(key, next);
        return { key, value: next };
      });
    },
    [key],
  );

  const scopeId = String(scope);
  const entry = current.scopes[scopeId] ?? { seen: [], done: [] };

  const markSeen = useCallback(
    (signal: Seen) =>
      update((r) => {
        const s = r.scopes[scopeId] ?? { seen: [], done: [] };
        if (s.seen.includes(signal)) return null;
        return { ...r, scopes: { ...r.scopes, [scopeId]: { ...s, seen: [...s.seen, signal] } } };
      }),
    [update, scopeId],
  );

  const markDone = useCallback(
    (ids: readonly string[], allDone: boolean) =>
      update((r) => {
        const s = r.scopes[scopeId] ?? { seen: [], done: [] };
        const fresh = ids.filter((id) => !s.done.includes(id));
        const day = typeof scope === 'number' ? scope : null;
        const streakDue = allDone && day !== null && r.streak?.day !== day;
        if (!fresh.length && !streakDue) return null;
        const streak = streakDue ? { day: day!, count: r.streak && r.streak.day === day! - 1 ? r.streak.count + 1 : 1 } : r.streak;
        return { ...r, streak, scopes: { ...r.scopes, [scopeId]: { ...s, done: [...s.done, ...fresh] } } };
      }),
    [update, scopeId, scope],
  );

  const seen = useMemo(() => new Set(entry.seen), [entry.seen]);
  const doneBefore = useMemo(() => new Set(entry.done), [entry.done]);
  const streak = current.streak && typeof scope === 'number' && current.streak.day >= scope - 1 ? current.streak.count : 0;
  return { seen, doneBefore, streak, markSeen, markDone };
}
