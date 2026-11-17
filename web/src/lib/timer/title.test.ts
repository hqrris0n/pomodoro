import { describe, expect, it } from 'vitest';
import { snapshot } from './schedule';
import { titleFor } from './title';
import type { TimerState } from '../types';

const MIN = 60_000;
const s: TimerState = { focusMs: 25 * MIN, breakMs: 5 * MIN, rounds: 2, elapsedMs: 0, anchorAt: 0 };

describe('titleFor', () => {
  it('describes each state', () => {
    expect(titleFor(null)).toBe('Pomo Café');
    expect(titleFor(snapshot(s, 1000))).toBe('24:59 · Focus');
    expect(titleFor(snapshot(s, 25 * MIN + 1000))).toBe('04:59 · Break');
    expect(titleFor(snapshot({ ...s, anchorAt: null, elapsedMs: 1000 }, 99))).toBe(
      'Paused · 24:59',
    );
    expect(titleFor(snapshot(s, 99 * MIN))).toBe('Your drink is ready');
  });
});
