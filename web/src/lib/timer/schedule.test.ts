import { describe, expect, it } from 'vitest';
import { elapsedAt, formatClock, newTimer, paused, resumed, snapshot, totalMs } from './schedule';
import type { TimerState } from '../types';

const MIN = 60_000;
const base: TimerState = {
  focusMs: 25 * MIN,
  breakMs: 5 * MIN,
  rounds: 3,
  elapsedMs: 0,
  anchorAt: 0,
};
const at = (min: number) => snapshot(base, min * MIN);

describe('snapshot', () => {
  it('walks focus, break, focus, ... done', () => {
    expect(at(0)).toMatchObject({
      phase: 'focus',
      round: 1,
      phaseRemainingMs: 25 * MIN,
      phaseProgress: 0,
    });
    expect(at(25)).toMatchObject({ phase: 'break', round: 1, phaseRemainingMs: 5 * MIN });
    expect(at(30)).toMatchObject({ phase: 'focus', round: 2 });
    for (const m of [85, 200]) {
      expect(at(m)).toMatchObject({ phase: 'done', phaseProgress: 1, running: false });
    }
  });

  it('has no break time in a single round', () => {
    expect(totalMs({ ...base, rounds: 1, breakMs: 15 * MIN })).toBe(25 * MIN);
  });
});

describe('pause and resume', () => {
  it('continues from the paused elapsed time', () => {
    const p = paused(base, 7 * MIN);
    expect(paused(p, 9 * MIN)).toEqual(p);
    const r = resumed(p, 17 * MIN);
    expect(resumed(r, 20 * MIN)).toEqual(r);
    expect(elapsedAt(r, 17 * MIN)).toBe(7 * MIN);
    expect(elapsedAt(r, 20 * MIN)).toBe(10 * MIN);
  });
});

describe('newTimer', () => {
  it('clamps its inputs', () => {
    const s = newTimer({ focusMin: 999, breakMin: 7, rounds: 0 }, 5);
    expect(s).toMatchObject({ focusMs: 180 * MIN, breakMs: 5 * MIN, rounds: 1, anchorAt: 5 });
  });
});

describe('formatClock', () => {
  it('rounds up to whole seconds', () => {
    expect(formatClock(1_500_000)).toBe('25:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(59_000)).toBe('00:59');
    expect(formatClock(3_900_000)).toBe('1:05:00');
    expect(formatClock(-5)).toBe('00:00');
  });
});
