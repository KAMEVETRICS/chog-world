// Village time of day, derived only from the committed tick and the next due time, so every
// viewer sees the same sky. No three.js import: the HUD uses this without loading the 3D bundle.
import { DAY_START_TICK, DAY_TICKS, TICK_MS } from '../../shared/rules';

export { DAY_TICKS };
/** Tick 0 starts mid-morning. Shared with the simulation, so Chogs go to bed as the sky darkens. */
const DAY_OFFSET = DAY_START_TICK / DAY_TICKS;

/** Fractional tick: committed tick plus progress towards the next one. */
export function fractionalTick(tick: string, nextDueAt: string, now: number): number {
  const remaining = Math.max(0, Math.min(TICK_MS, new Date(nextDueAt).getTime() - now));
  return Number(tick) + (1 - remaining / TICK_MS);
}

/** 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = midnight. */
export function timeOfDay(fractional: number): number {
  const t = fractional / DAY_TICKS + DAY_OFFSET;
  return t - Math.floor(t);
}

export function dayNumber(fractional: number): number {
  return Math.floor(fractional / DAY_TICKS + DAY_OFFSET) + 1;
}

export function phaseName(tod: number): 'Dawn' | 'Morning' | 'Afternoon' | 'Dusk' | 'Night' {
  if (tod < 0.06 || tod >= 0.94) return 'Dawn';
  if (tod < 0.25) return 'Morning';
  if (tod < 0.45) return 'Afternoon';
  if (tod < 0.56) return 'Dusk';
  return 'Night';
}

/** 0 in daylight, 1 in deep night; smooth at dusk and dawn. */
export function nightness(tod: number): number {
  const s = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  return s(0.47, 0.6, tod) * (1 - s(0.88, 0.99, tod));
}
