import type { TimerState } from '../types';

export type TimerView = {
  phase: 'focus' | 'break' | 'done';
  /** 1-based focus round; during a break, the round just finished. */
  round: number;
  rounds: number;
  phaseRemainingMs: number;
  /** 0..1 within the current phase; 1 when done. */
  phaseProgress: number;
  running: boolean;
};

const MINUTE = 60_000;
const BREAKS = [5, 10, 15];

export function totalMs(state: TimerState): number {
  return state.rounds * state.focusMs + (state.rounds - 1) * state.breakMs;
}

export function elapsedAt(state: TimerState, now: number): number {
  const raw = state.elapsedMs + (state.anchorAt === null ? 0 : now - state.anchorAt);
  return Math.min(Math.max(raw, 0), totalMs(state));
}

export function snapshot(state: TimerState, now: number): TimerView {
  const total = totalMs(state);
  const elapsed = elapsedAt(state, now);
  const { rounds, focusMs, breakMs } = state;
  if (elapsed >= total) {
    return {
      phase: 'done',
      round: rounds,
      rounds,
      phaseRemainingMs: 0,
      phaseProgress: 1,
      running: false,
    };
  }
  const cycle = focusMs + breakMs;
  const index = Math.floor(elapsed / cycle);
  const within = elapsed - index * cycle;
  const inFocus = within < focusMs;
  const length = inFocus ? focusMs : breakMs;
  const phaseElapsed = inFocus ? within : within - focusMs;
  return {
    phase: inFocus ? 'focus' : 'break',
    round: index + 1,
    rounds,
    phaseRemainingMs: length - phaseElapsed,
    phaseProgress: phaseElapsed / length,
    running: state.anchorAt !== null,
  };
}

export function newTimer(
  opts: { focusMin: number; breakMin: number; rounds: number },
  now: number,
): TimerState {
  const clampInt = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(Math.max(Math.round(n), lo), hi) : fallback;
  const focusMin = clampInt(opts.focusMin, 1, 180, 25);
  const rounds = clampInt(opts.rounds, 1, 6, 1);
  const breakMin = BREAKS.includes(opts.breakMin) ? opts.breakMin : 5;
  return {
    focusMs: focusMin * MINUTE,
    breakMs: breakMin * MINUTE,
    rounds,
    elapsedMs: 0,
    anchorAt: now,
  };
}

export function paused(state: TimerState, now: number): TimerState {
  if (state.anchorAt === null) return { ...state };
  return { ...state, elapsedMs: elapsedAt(state, now), anchorAt: null };
}

export function resumed(state: TimerState, now: number): TimerState {
  if (state.anchorAt !== null) return { ...state };
  return { ...state, anchorAt: now };
}

/** Remaining time rounded up to a whole second: 25:00, 00:59, 1:05:00. */
export function formatClock(ms: number): string {
  const secs = ms > 0 ? Math.ceil(ms / 1000) : 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
