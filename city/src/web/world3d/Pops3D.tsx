// Floating "+5" pops over residents when something they earned or gave lands: wages, sales, harvests,
// gifts and project gifts. Read from committed events only, so every pop is something that really happened.
// Routine work by strangers stays quiet; your own villager and Chogs, the Chog you are watching, and
// everything shared (gifts, projects) always show. Finished homes and projects get confetti and banners
// instead (see fx/celebrations).
import { useContext, useEffect, useRef, useState } from 'react';
import type { CityEvent, Resource, WorldState } from '../../shared/contracts';
import { PROJECTS } from '../../shared/rules';
import type { XZ } from './layout';
import { PROJECT_SITES } from './layout';
import { OverlayContext } from './overlay';
import { LABEL_PRIORITY, ScaledHtml } from './ScaledHtml';
import './pops.css';

export type PopKind = 'coin' | Resource | 'star';

export interface Pop {
  id: string;
  /** Who or what it floats over: a resident key, or `project:<id>`. */
  over: string;
  /** A signed amount ("+5"), or null for a message pop. */
  amount: number | null;
  /** A message ("Plaza Fountain built!"), or null for an amount pop. */
  message: string | null;
  kind: PopKind;
  /** Your own earnings get the big treatment. */
  big: boolean;
}

/** How long a pop lives on screen, matching the CSS animation. */
export const POP_MS = 2200;
/** More than this at once is noise, not feedback; a phone screen holds fewer. */
const MAX_POPS = 14;
const MAX_POPS_SMALL_SCREEN = 4;
/** Pops of one kind within about a work site become one total, so a busy quarry shows "+6", not a pile. */
const MERGE_DISTANCE = 3;

const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/** The pops one committed event deserves, for a viewer who owns `mine` and is watching `watching`. */
export function popsFor(event: CityEvent, world: WorldState, mine: ReadonlySet<string>, watching: string | null): Pop[] {
  const pops: Pop[] = [];
  const care = (key: string) => mine.has(key) || key === watching;
  event.data.changes.forEach((c, i) => {
    const id = `${event.revision}:${i}`;
    switch (c.type) {
      case 'citizen_worked':
        if (mine.has(c.citizenKey) && c.wage - c.tax > 0) pops.push({ id, over: c.citizenKey, amount: c.wage - c.tax, message: null, kind: 'coin', big: true });
        break;
      case 'gathered':
        if (care(c.agentKey)) pops.push({ id, over: c.agentKey, amount: c.amount, message: null, kind: c.resource, big: mine.has(c.agentKey) });
        break;
      case 'traded':
        if (care(c.agentKey)) pops.push({ id, over: c.agentKey, amount: c.side === 'sell' ? c.coins : -c.coins, message: null, kind: 'coin', big: mine.has(c.agentKey) });
        break;
      case 'gift':
        pops.push({ id, over: c.to, amount: c.amount, message: null, kind: c.asset === 'coins' ? 'coin' : c.asset, big: mine.has(c.to) });
        break;
      case 'contributed':
        pops.push({ id, over: `project:${c.projectId}`, amount: c.amount, message: null, kind: c.asset === 'coins' ? 'coin' : c.asset, big: mine.has(c.from) });
        break;
      case 'project_completed':
        pops.push({ id, over: `project:${c.projectId}`, amount: null, message: `${PROJECTS[c.projectId].name} built!`, kind: 'star', big: true });
        break;
    }
  });
  return pops;
}

function PopIcon({ kind }: { kind: PopKind }) {
  if (kind === 'star') {
    return (
      <svg width="16" height="16" viewBox="-8 -8 16 16" aria-hidden="true">
        <path d="M0 -7 L2 -2.4 L7 -2 L3.2 1.4 L4.3 6.4 L0 3.8 L-4.3 6.4 L-3.2 1.4 L-7 -2 L-2 -2.4 Z" fill="#f0c22e" stroke="var(--ink)" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    );
  }
  return <span className={`pop-dot pop-dot--${kind}`} aria-hidden="true" />;
}

/** Turns new events into pops and floats them over whoever they belong to. */
export function Pops3D({
  events,
  world,
  mine,
  watching,
  where,
}: {
  events: readonly CityEvent[];
  world: WorldState;
  mine: ReadonlySet<string>;
  watching: string | null;
  /** Where a resident stands right now, or null if not on screen. */
  where: (key: string) => XZ | null;
}) {
  const overlay = useContext(OverlayContext);
  const [pops, setPops] = useState<Array<Pop & { at: XZ; stack: number }>>([]);
  // Events already on screen when the village opened are history, not news: start after the newest one.
  const seen = useRef<bigint | null>(null);
  const latest = useRef({ world, mine, watching, where });
  latest.current = { world, mine, watching, where };
  // Each batch clears itself; a newer batch must not cancel an older one's timer.
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  useEffect(() => {
    const newest = events.length ? BigInt(events[events.length - 1]!.revision) : 0n;
    if (seen.current === null) {
      seen.current = newest;
      return;
    }
    const fresh = events.filter((e) => BigInt(e.revision) > seen.current!);
    seen.current = newest > seen.current ? newest : seen.current;
    if (!fresh.length) return;
    const { world: w, mine: m, watching: watched, where: at } = latest.current;
    const placed: Array<Pop & { at: XZ; stack: number }> = [];
    for (const pop of fresh.flatMap((e) => popsFor(e, w, m, watched))) {
      const spot = pop.over.startsWith('project:') ? PROJECT_SITES[pop.over.slice(8) as keyof typeof PROJECT_SITES]?.pos ?? null : at(pop.over);
      if (!spot) continue;
      const near = (p: { at: XZ }) => Math.hypot(p.at[0] - spot[0], p.at[1] - spot[1]) < MERGE_DISTANCE;
      const twin = pop.amount !== null ? placed.find((p) => p.amount !== null && p.kind === pop.kind && Math.sign(p.amount) === Math.sign(pop.amount!) && near(p)) : undefined;
      if (twin) {
        twin.amount! += pop.amount!;
        twin.big ||= pop.big;
        continue;
      }
      placed.push({ ...pop, at: spot, stack: placed.filter(near).length });
    }
    if (!placed.length) return;
    // When there's too much at once, keep what matters most: your own pops first, then the biggest amounts.
    const room = window.innerWidth <= 760 ? MAX_POPS_SMALL_SCREEN : MAX_POPS;
    placed.sort((a, b) => Number(b.big) - Number(a.big) || Math.abs(b.amount ?? 999) - Math.abs(a.amount ?? 999));
    placed.splice(room);
    setPops((current) => [...current, ...placed].slice(-room));
    const ids = new Set(placed.map((p) => p.id));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setPops((current) => current.filter((p) => !ids.has(p.id)));
    }, POP_MS + placed.length * 140);
    timers.current.add(timer);
  }, [events]);

  return (
    <>
      {pops.map((pop) => (
        <ScaledHtml
          key={pop.id}
          portal={overlay as React.RefObject<HTMLElement>}
          position={[pop.at[0], 1.55 + pop.stack * 0.42, pop.at[1]]}
          factor={Infinity}
          priority={LABEL_PRIORITY.pop}
          center
          zIndexRange={[30, 20]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`pop pop--${pop.kind}${pop.big ? ' pop--big' : ''}`} style={{ animationDelay: `${pop.stack * 140}ms` }}>
            <PopIcon kind={pop.kind} />
            <span className={pop.amount !== null ? 'num' : undefined}>{pop.amount !== null ? signed(pop.amount) : pop.message}</span>
          </div>
        </ScaledHtml>
      ))}
    </>
  );
}
