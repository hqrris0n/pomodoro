import { describe, expect, it } from 'vitest';
import { clampProgress, liquidBands, mainColor, type Glass } from './glass';

function glass(layers: Glass['layers']): Glass {
  return { layers, ice: false, topping: 'none', straw: null, hot: false };
}

const twoLayer = glass([
  { color: '#111111', share: 0.25 },
  { color: '#eeeeee', share: 0.75 },
]);

const threeLayer = glass([
  { color: '#aa0000', share: 0.5 },
  { color: '#00aa00', share: 0.3 },
  { color: '#0000aa', share: 0.2 },
]);

function total(bands: { height: number }[]) {
  return bands.reduce((sum, band) => sum + band.height, 0);
}

function expectTiled(bands: { y: number; height: number }[]) {
  let next = 0;
  for (const band of bands) {
    expect(band.y).toBe(next);
    expect(Number.isInteger(band.height)).toBe(true);
    expect(band.height).toBeGreaterThan(0);
    next += band.height;
  }
}

describe('liquidBands', () => {
  it('is empty at progress 0', () => {
    expect(liquidBands(twoLayer, 0, 60)).toEqual([]);
  });

  it('fills the whole interior at progress 1, in proportion to the shares', () => {
    const bands = liquidBands(threeLayer, 1, 60);
    expect(bands).toEqual([
      { color: '#aa0000', y: 0, height: 30 },
      { color: '#00aa00', y: 30, height: 18 },
      { color: '#0000aa', y: 48, height: 12 },
    ]);
    expect(total(bands)).toBe(60);
  });

  it('tiles exactly when shares do not divide the height evenly', () => {
    const odd = glass([
      { color: 'a', share: 1 / 3 },
      { color: 'b', share: 1 / 3 },
      { color: 'c', share: 1 / 3 },
    ]);
    const bands = liquidBands(odd, 1, 61);
    expectTiled(bands);
    expect(total(bands)).toBe(61);
    for (const band of bands) expect(Math.abs(band.height - 61 / 3)).toBeLessThan(1);
  });

  it('shows only the lower portion at progress 0.5', () => {
    // 25% dark at the bottom (15 units), 75% light above; half of 60 is 30.
    expect(liquidBands(twoLayer, 0.5, 60)).toEqual([
      { color: '#111111', y: 0, height: 15 },
      { color: '#eeeeee', y: 15, height: 15 },
    ]);
  });

  it('shows only the bottom layer while the fill is still inside it', () => {
    expect(liquidBands(twoLayer, 0.1, 60)).toEqual([{ color: '#111111', y: 0, height: 6 }]);
  });

  it('rounds the visible height to whole units and tiles at every step', () => {
    for (let i = 0; i <= 100; i++) {
      const progress = i / 100;
      const bands = liquidBands(threeLayer, progress, 61);
      expectTiled(bands);
      expect(total(bands)).toBe(Math.round(progress * 61));
    }
  });

  it('clamps progress outside 0..1', () => {
    expect(liquidBands(twoLayer, -0.4, 60)).toEqual([]);
    expect(liquidBands(twoLayer, 1.7, 60)).toEqual(liquidBands(twoLayer, 1, 60));
    expect(liquidBands(twoLayer, Number.NaN, 60)).toEqual([]);
  });

  it('normalises shares that do not sum to 1', () => {
    const loose = glass([
      { color: 'a', share: 2 },
      { color: 'b', share: 2 },
    ]);
    expect(liquidBands(loose, 1, 10)).toEqual([
      { color: 'a', y: 0, height: 5 },
      { color: 'b', y: 5, height: 5 },
    ]);
  });
});

describe('clampProgress', () => {
  it('keeps values in range and maps junk to 0', () => {
    expect(clampProgress(0.3)).toBe(0.3);
    expect(clampProgress(2)).toBe(1);
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('mainColor', () => {
  it('picks the layer with the largest share', () => {
    expect(mainColor(twoLayer)).toBe('#eeeeee');
    expect(mainColor(threeLayer)).toBe('#aa0000');
  });
});
