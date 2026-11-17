import { describe, expect, it } from 'vitest';
import { LEMON_SIZE, MACHINE_SIZE, PLANT_SIZE, creamRuns, foamRuns } from './art';
import { BARISTA_SIZE, STRIP, STRIP_WIDTH, pairOffset } from './barista';
import { mirror, over, raise, toRuns } from './pixels';

describe('pixel helpers', () => {
  it('merges horizontal runs and skips transparent pixels', () => {
    expect(toRuns(['aab.a'], { a: 'A', b: 'B' }, 10, 20)).toEqual([
      { x: 10, y: 20, w: 2, fill: 'A' },
      { x: 12, y: 20, w: 1, fill: 'B' },
      { x: 14, y: 20, w: 1, fill: 'A' },
    ]);
  });

  it('rejects ragged rows and unknown colours', () => {
    expect(() => toRuns(['aa', 'a'], { a: 'A' })).toThrow();
    expect(() => toRuns(['z'], { a: 'A' })).toThrow();
  });

  it('overlays, mirrors and raises', () => {
    expect(over(['....', '....'], ['ab'], 1, 1)).toEqual(['....', '.ab.']);
    expect(mirror(['ab.'])).toEqual(['.ba']);
    expect(raise(['a.', '.b'], 1)).toEqual(['.b', '..']);
  });
});

describe('sprite data', () => {
  it('builds every sprite without ragged rows', () => {
    expect(MACHINE_SIZE.w).toBe(26);
    expect(PLANT_SIZE.w).toBe(14);
    expect(LEMON_SIZE.w).toBe(13);
    expect(creamRuns(44, 0, 0).length).toBeGreaterThan(0);
    expect(foamRuns(44, 0, 0).length).toBeGreaterThan(0);
  });

  it('keeps every barista pixel inside its 16x16 frame', () => {
    for (const run of STRIP) {
      expect(run.y).toBeGreaterThanOrEqual(0);
      expect(run.y).toBeLessThan(BARISTA_SIZE);
      const frame = Math.floor(run.x / BARISTA_SIZE);
      expect(Math.floor((run.x + run.w - 1) / BARISTA_SIZE)).toBe(frame);
      expect(run.x + run.w).toBeLessThanOrEqual(STRIP_WIDTH);
    }
    expect(pairOffset('walkFull')).toBe(0);
    expect(pairOffset('walkEmpty')).toBe(2 * BARISTA_SIZE);
  });
});
