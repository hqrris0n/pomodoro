import { beforeEach, describe, expect, it } from 'vitest';
import { Order } from './order.svelte';

describe('Order', () => {
  beforeEach(() => localStorage.clear());

  it('starts at 30 minutes, 1 round, 5-minute break', () => {
    const o = new Order();
    expect([o.focusMin, o.rounds, o.breakMin]).toEqual([30, 1, 5]);
  });

  it('clamps and rounds, and ignores junk', () => {
    const o = new Order();
    o.setFocusMin(200);
    expect(o.focusMin).toBe(180);
    o.setFocusMin(0);
    expect(o.focusMin).toBe(1);
    o.setFocusMin(12.6);
    expect(o.focusMin).toBe(13);
    o.setFocusMin(NaN);
    expect(o.focusMin).toBe(13);
    o.setRounds(9);
    expect(o.rounds).toBe(6);
    o.setRounds(-1);
    expect(o.rounds).toBe(1);
    o.setBreakMin(7);
    expect(o.breakMin).toBe(5);
    o.setBreakMin(15);
    expect(o.breakMin).toBe(15);
  });

  it('totals breaks only between rounds', () => {
    const o = new Order();
    expect(o.totalMin).toBe(30);
    o.setRounds(3);
    expect(o.totalMin).toBe(100);
    o.setBreakMin(10);
    expect(o.totalMin).toBe(110);
  });

  it('survives a remount, and rejects a corrupt saved value', () => {
    const o = new Order();
    o.setFocusMin(47);
    o.setRounds(4);
    o.setBreakMin(10);
    const again = new Order();
    expect([again.focusMin, again.rounds, again.breakMin]).toEqual([47, 4, 10]);

    localStorage.setItem('cafe:setup', JSON.stringify({ focusMin: 'x', rounds: 99, breakMin: 8 }));
    const bad = new Order();
    expect([bad.focusMin, bad.rounds, bad.breakMin]).toEqual([30, 6, 5]);
  });
});
