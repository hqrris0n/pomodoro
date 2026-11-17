import { beforeEach, describe, expect, it } from 'vitest';
import { load, save } from './storage';

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a value', () => {
    save('k', { a: [1, 2], b: 'x' });
    expect(load('k', null)).toEqual({ a: [1, 2], b: 'x' });
    expect(localStorage.getItem('cafe:k')).not.toBeNull();
  });

  it('returns the fallback for a missing key', () => {
    expect(load('missing', 42)).toBe(42);
  });

  it('returns the fallback for corrupt JSON', () => {
    localStorage.setItem('cafe:bad', '{not json');
    expect(load('bad', 'fb')).toBe('fb');
  });
});
