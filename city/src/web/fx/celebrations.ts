// The village's big moments, read from committed events and the world: a home finished, a title earned,
// a shared project built, the village growing a rank. Each becomes a banner (for moments that are yours or
// everyone's), a burst of confetti in the world, and a sound. Strangers' homes get the burst only.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CityEvent, WorldState } from '../../shared/contracts';
import { DECOR_IDS } from '../../shared/contracts';
import { MAX_DECOR, PROJECTS } from '../../shared/rules';
import { homeName } from '../format';
import { titleOf } from '../resident/titles';
import { growthOf } from '../town/rank';
import { play, type Cue } from './sound';

/** Where a burst goes off. */
export type BurstAt = { kind: 'plot'; plotId: string } | { kind: 'project'; id: keyof typeof PROJECTS } | { kind: 'plaza' };

export interface Celebration {
  id: string;
  /** Shown as a banner when set; otherwise the moment is only a burst (and maybe a sound). */
  banner: { kind: 'rank' | 'project' | 'home' | 'title'; title: string; detail: string } | null;
  burst: { at: BurstAt; big: boolean } | null;
  cue: Cue | null;
}

/** The moments in one committed event, for a viewer who owns `mine`. */
export function celebrationsFor(event: CityEvent, world: WorldState, mine: ReadonlySet<string>): Celebration[] {
  const out: Celebration[] = [];
  let earned = false;
  event.data.changes.forEach((c, i) => {
    const id = `${event.revision}:${i}`;
    switch (c.type) {
      case 'build_completed': {
        const agent = world.agents.find((a) => a.key === c.agentKey);
        if (!agent) return;
        const yours = mine.has(agent.key);
        const before = titleOf({ ...agent, homeLevel: c.level - 1 });
        const after = titleOf({ ...agent, homeLevel: c.level });
        out.push({
          id,
          banner: yours
            ? {
                kind: before !== after ? 'title' : 'home',
                title: `${agent.name} finished a ${homeName(c.homeStyle, c.level)}`,
                detail: before !== after ? `Level ${c.level}, and ${agent.name} is now a ${after}.` : `Home level ${c.level}.`,
              }
            : null,
          burst: { at: { kind: 'plot', plotId: agent.plotId }, big: yours },
          cue: yours ? 'levelUp' : null,
        });
        return;
      }
      case 'decorated': {
        const agent = world.agents.find((a) => a.key === c.agentKey);
        const full = Math.min(MAX_DECOR, DECOR_IDS.length);
        if (agent && mine.has(agent.key) && agent.decor.length === full) {
          out.push({
            id,
            banner: { kind: 'title', title: `${agent.name} earned Gardener`, detail: 'A full garden: every decoration a home can hold.' },
            burst: { at: { kind: 'plot', plotId: agent.plotId }, big: true },
            cue: 'levelUp',
          });
        }
        return;
      }
      case 'project_completed':
        out.push({
          id,
          banner: { kind: 'project', title: `The ${PROJECTS[c.projectId].name} is built!`, detail: PROJECTS[c.projectId].effect },
          burst: { at: { kind: 'project', id: c.projectId }, big: true },
          cue: 'fanfare',
        });
        return;
      case 'citizen_worked':
        earned ||= mine.has(c.citizenKey) && c.wage - c.tax > 0;
        return;
      case 'traded':
        earned ||= mine.has(c.agentKey) && c.side === 'sell';
        return;
      case 'gift':
        earned ||= mine.has(c.to) && c.asset === 'coins';
        return;
    }
  });
  if (earned && !out.some((c) => c.cue)) out.push({ id: `${event.revision}:coins`, banner: null, burst: null, cue: 'coin' });
  return out;
}

/**
 * Watches committed events and the village's rank, and hands out new moments: banners to show one at a
 * time, bursts for the 3D world. Events already on screen when the village opened are history, not news.
 */
export function useCelebrations({
  events,
  world,
  mine,
  enabled,
  confetti,
}: {
  events: readonly CityEvent[];
  world: WorldState | undefined;
  mine: ReadonlySet<string>;
  enabled: boolean;
  /** False for players who asked for reduced motion: banners and sounds, no flying confetti. */
  confetti: boolean;
}) {
  const [banners, setBanners] = useState<Celebration[]>([]);
  const [bursts, setBursts] = useState<Celebration[]>([]);
  const seen = useRef<bigint | null>(null);
  const rank = useRef<string | null>(null);
  const latest = useRef({ world, mine });
  latest.current = { world, mine };

  useEffect(() => {
    if (!enabled) return;
    const newest = events.length ? BigInt(events[events.length - 1]!.revision) : 0n;
    if (seen.current === null) {
      seen.current = newest;
      return;
    }
    const fresh = events.filter((e) => BigInt(e.revision) > seen.current!);
    if (newest > seen.current) seen.current = newest;
    const { world: w, mine: m } = latest.current;
    if (!fresh.length || !w) return;
    const moments = fresh.flatMap((e) => celebrationsFor(e, w, m));
    if (!moments.length) return;
    const cue = (['fanfare', 'levelUp', 'coin'] as const).find((c) => moments.some((m) => m.cue === c));
    if (cue) play(cue);
    setBanners((q) => [...q, ...moments.filter((m) => m.banner)]);
    if (confetti) setBursts((b) => [...b, ...moments.filter((m) => m.burst)]);
  }, [events, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // The village growing a rank: everyone's moment.
  useEffect(() => {
    if (!enabled || !world) return;
    const now = growthOf(world).rank.name;
    const before = rank.current;
    rank.current = now;
    if (before === null || before === now) return;
    play('fanfare');
    const moment: Celebration = {
      id: `rank:${now}:${world.tick}`,
      banner: { kind: 'rank', title: `Chog City is now a ${now}!`, detail: 'Every home, villager and project helped it grow.' },
      burst: { at: { kind: 'plaza' }, big: true },
      cue: 'fanfare',
    };
    setBanners((q) => [...q, moment]);
    if (confetti) setBursts((b) => [...b, moment]);
  }, [world, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const dismissBanner = useCallback(() => setBanners((q) => q.slice(1)), []);
  const burstDone = useCallback((id: string) => setBursts((b) => b.filter((x) => x.id !== id)), []);
  return { banner: banners[0] ?? null, dismissBanner, bursts, burstDone };
}
