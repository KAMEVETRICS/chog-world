// Small, soft sounds for good moments, synthesised in the browser (no audio files to load). Browsers only
// allow sound after the player touches the page, so nothing plays before their first click or key.
// The mute choice is remembered in this browser.
import { useSyncExternalStore } from 'react';

export type Cue = 'coin' | 'goal' | 'allGoals' | 'levelUp' | 'fanfare';

const MUTE_KEY = 'chog-city:muted';
let muted = (() => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

let context: AudioContext | null = null;
let unlocked = false;

/** Wakes audio on the first touch of the page; until then every cue is silently skipped. */
function unlock() {
  if (unlocked || typeof window === 'undefined') return;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  context ??= new Ctor();
  void context.resume();
  unlocked = true;
}
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, unlock, { once: false, passive: true });
}

/** A short note with a soft attack and a clean decay. */
function note(ctx: AudioContext, freq: number, at: number, length: number, volume: number, type: OscillatorType = 'sine') {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

// Notes in a warm, major key (Hz).
const C5 = 523.25, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5, G4 = 392;

const CUES: Record<Cue, (ctx: AudioContext, t: number) => void> = {
  coin: (ctx, t) => {
    note(ctx, E6, t, 0.12, 0.05, 'triangle');
    note(ctx, C6 * 1.5, t + 0.06, 0.22, 0.04, 'triangle');
  },
  goal: (ctx, t) => {
    note(ctx, G5, t, 0.18, 0.06);
    note(ctx, C6, t + 0.08, 0.28, 0.05);
  },
  allGoals: (ctx, t) => [C5, E5, G5, C6].forEach((f, i) => note(ctx, f, t + i * 0.09, 0.32, 0.055)),
  levelUp: (ctx, t) => {
    [G4, C5, E5, G5].forEach((f, i) => note(ctx, f, t + i * 0.08, 0.3, 0.06, 'triangle'));
    note(ctx, C6, t + 0.34, 0.6, 0.05, 'triangle');
  },
  fanfare: (ctx, t) => {
    [C5, E5, G5].forEach((f, i) => note(ctx, f, t + i * 0.11, 0.26, 0.06, 'triangle'));
    [C5, E5, G5, C6].forEach((f) => note(ctx, f, t + 0.38, 0.9, 0.035, 'triangle'));
    note(ctx, A5, t + 0.38, 0.9, 0.02);
  },
};

/** Plays a cue now, unless muted or the page hasn't been touched yet. */
export function play(cue: Cue): void {
  if (muted || !unlocked || !context) return;
  CUES[cue](context, context.currentTime + 0.01);
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // Remembered for this visit only.
  }
  listeners.forEach((l) => l());
}

export function useMuted(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => muted,
    () => muted,
  );
}
