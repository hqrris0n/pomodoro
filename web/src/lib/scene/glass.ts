import type { Drink } from '../types';

export type Glass = Drink['glass'];

/** One visible liquid band, in grid units measured up from the glass interior's floor. */
export type Band = { color: string; y: number; height: number };

/** Clamp to 0..1; anything that is not a finite number counts as 0. */
export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/**
 * The liquid bands visible at `progress`, bottom to top.
 *
 * The full column (progress 1) splits `innerHeight` between the layers in
 * proportion to their shares, using rounded cumulative boundaries so heights
 * are integers that tile exactly. At progress p only the lowest
 * round(p * innerHeight) units of that column are visible. Zero-height bands
 * are left out.
 */
export function liquidBands(glass: Glass, progress: number, innerHeight: number): Band[] {
  const total = glass.layers.reduce((sum, layer) => sum + Math.max(0, layer.share), 0);
  const height = Math.max(0, Math.round(innerHeight));
  if (total <= 0 || height === 0) return [];

  const visible = Math.round(clampProgress(progress) * height);
  const bands: Band[] = [];
  let cumulative = 0;
  let bottom = 0;
  for (const layer of glass.layers) {
    cumulative += Math.max(0, layer.share);
    const top = Math.round((cumulative / total) * height);
    const shown = Math.min(top, visible) - bottom;
    if (shown > 0) bands.push({ color: layer.color, y: bottom, height: shown });
    bottom = top;
  }
  return bands;
}

/** The colour of the layer with the largest share (the first one on a tie). */
export function mainColor(glass: Glass): string {
  let best = glass.layers[0];
  for (const layer of glass.layers) if (layer.share > best.share) best = layer;
  return best?.color ?? 'transparent';
}
