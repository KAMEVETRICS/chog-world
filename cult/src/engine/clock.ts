import { PHASES, type Phase, type Timing } from "../rules.js";

export interface ClockReading {
  readonly cycle: number;
  readonly phase: Phase;
  readonly phaseEndsAtMs: number;
}

/** Cycle and phase at `nowMs` for a cult that started at `genesisMs`. The caller supplies the time. */
export function cycleClock(genesisMs: number, nowMs: number, timing: Timing): ClockReading {
  if (nowMs < genesisMs) throw new Error("The requested time is before genesis.");
  const cycleMs = PHASES.reduce((sum, phase) => sum + timing.phaseMs[phase], 0);
  const elapsed = nowMs - genesisMs;
  const cycle = Math.floor(elapsed / cycleMs);
  let boundary = genesisMs + cycle * cycleMs;
  for (const phase of PHASES) {
    boundary += timing.phaseMs[phase];
    if (nowMs < boundary) return { cycle, phase, phaseEndsAtMs: boundary };
  }
  throw new Error("Unreachable: the time falls outside its own cycle.");
}
