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

  it('skipBreak notifies once, reports break to focus once, and tick does not repeat it', () => {
    const e = new TimerEngine();
    e.start(opts);
    vi.advanceTimersByTime(26 * MIN);
    const phase = vi.fn();
    const change = vi.fn();
    e.onPhaseChange(phase);
    e.onChange(change);
    e.skipBreak();
    expect(change).toHaveBeenCalledTimes(1);
    expect(phase).toHaveBeenCalledTimes(1);
    expect(phase.mock.calls[0].slice(0, 2)).toEqual(['break', 'focus']);
    expect(e.view).toMatchObject({ phase: 'focus', round: 2, phaseRemainingMs: 25 * MIN });
    vi.advanceTimersByTime(2000);
    expect(phase).toHaveBeenCalledTimes(1);
    e.skipBreak();
    expect(change).toHaveBeenCalledTimes(1);
  });

  it('apply reports a phase change between live timers, but not a join or a stop', () => {
    const owner = new TimerEngine();
    owner.start(opts);
    vi.advanceTimersByTime(26 * MIN);
    const skipped = (() => {
      owner.skipBreak();
      return owner.state!;
    })();

    const inBreak = {
      focusMs: 25 * MIN,
      breakMs: 5 * MIN,
      rounds: 3,
      elapsedMs: 26 * MIN,
      anchorAt: Date.now(),
    };
    const guest = new TimerEngine();
    guest.apply(inBreak);
    const fn = vi.fn();
    guest.onPhaseChange(fn);
    guest.apply(skipped);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0].slice(0, 2)).toEqual(['break', 'focus']);

    const joiner = new TimerEngine();
    joiner.apply(null);
    const j = vi.fn();
    joiner.onPhaseChange(j);
    joiner.apply(skipped);
    joiner.apply(null);
    expect(j).not.toHaveBeenCalled();
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

  it('tells onChange why Pause, Resume and Skip break fired, and nothing for the rest', () => {
    const e = new TimerEngine();
    const fn = vi.fn();
    e.onChange(fn);
    e.start(opts);
    expect(fn).toHaveBeenLastCalledWith(e.state);
    e.pause();
    expect(fn).toHaveBeenLastCalledWith(e.state, 'pause');
    e.resume();
    expect(fn).toHaveBeenLastCalledWith(e.state, 'resume');
    vi.advanceTimersByTime(opts.focusMin * 60_000 + 1000);
    e.skipBreak();
    expect(fn).toHaveBeenLastCalledWith(e.state, 'skipBreak');
    fn.mockClear();
    e.apply(null);
    e.restart();
    e.stop();
    expect(fn.mock.calls.every((c) => c.length === 1)).toBe(true);
  });
});
