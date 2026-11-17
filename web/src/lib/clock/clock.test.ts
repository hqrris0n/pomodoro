import { beforeEach, describe, expect, it } from 'vitest';
import { ClockStore, formatTime } from './clock.svelte';

const at = (h: number, m: number) => new Date(2026, 0, 5, h, m);

describe('formatTime', () => {
  it('formats 12-hour with leading zeros and a suffix', () => {
    expect(formatTime(at(0, 7), '12')).toEqual({ time: '12:07', suffix: 'AM' });
    expect(formatTime(at(9, 5), '12')).toEqual({ time: '09:05', suffix: 'AM' });
    expect(formatTime(at(12, 30), '12')).toEqual({ time: '12:30', suffix: 'PM' });
    expect(formatTime(at(13, 5), '12')).toEqual({ time: '01:05', suffix: 'PM' });
    expect(formatTime(at(21, 5), '12')).toEqual({ time: '09:05', suffix: 'PM' });
  });

  it('formats 24-hour with no suffix', () => {
    expect(formatTime(at(9, 5), '24')).toEqual({ time: '09:05', suffix: '' });
    expect(formatTime(at(0, 0), '24')).toEqual({ time: '00:00', suffix: '' });
    expect(formatTime(at(23, 59), '24')).toEqual({ time: '23:59', suffix: '' });
  });
});

describe('ClockStore', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to off and 12-hour', () => {
    const s = new ClockStore();
    expect(s.show).toBe(false);
    expect(s.format).toBe('12');
  });

  it('persists show and format', () => {
    const a = new ClockStore();
    a.show = true;
    a.format = '24';
    const b = new ClockStore();
    expect(b.show).toBe(true);
    expect(b.format).toBe('24');
  });

  it('ignores garbage stored values', () => {
    localStorage.setItem('cafe:clockShow', JSON.stringify('yes'));
    localStorage.setItem('cafe:clockFormat', JSON.stringify('13'));
    const s = new ClockStore();
    expect(s.show).toBe(false);
    expect(s.format).toBe('12');
  });
});
