import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerEngine } from './engine.svelte';

const MIN = 60_000;
const opts = { focusMin: 25, breakMin: 5, rounds: 3 };

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('TimerEngine', () => {
  it('restores a running timer for the later clock', () => {
    const a = new TimerEngine();
    a.start(opts);
    vi.setSystemTime(1_000_000 + 10 * MIN);
    const b = new TimerEngine();
    expect(b.view).toMatchObject({ phase: 'focus', running: true, phaseRemainingMs: 15 * MIN });
  });

  it('fires onPhaseChange once when ticking crosses a boundary', () => {
    const e = new TimerEngine();
    const fn = vi.fn();
    e.onPhaseChange(fn);
    e.start(opts);
    vi.advanceTimersByTime(26 * MIN);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0].slice(0, 2)).toEqual(['focus', 'break']);
  });

  it('does not fire onPhaseChange for a boundary passed while closed', () => {
    new TimerEngine().start(opts);
    vi.setSystemTime(1_000_000 + 26 * MIN);
    const e = new TimerEngine();
    const fn = vi.fn();
    e.onPhaseChange(fn);
    vi.advanceTimersByTime(2000);
    expect(e.view?.phase).toBe('break');
    expect(fn).not.toHaveBeenCalled();
  });

  it('notifies onChange for local actions but not apply', () => {
    const e = new TimerEngine();
    e.start(opts);
    const fn = vi.fn();
    e.onChange(fn);
    e.apply(null);
    expect(fn).not.toHaveBeenCalled();
    e.start(opts);
    fn.mockClear();
    e.pause();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
