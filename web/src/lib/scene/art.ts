// Static pixel art for the counter props and glass toppings.
import { over, toRuns, type Run } from './pixels';

const pad = (width: number, rows: string[]) => rows.map((row) => row.padEnd(width, '.'));

const PROPS = {
  k: 'var(--ink)',
  R: 'var(--strawberry)',
  B: 'var(--berry)',
  W: 'var(--white)',
  f: 'var(--foam)',
  s: 'var(--sky)',
  d: 'var(--dusk)',
  y: 'var(--butter)',
  t: 'var(--toffee)',
  c: 'var(--caramel)',
  w: 'var(--walnut)',
  G: 'var(--matcha)',
  m: 'var(--moss)',
  p: 'var(--plum)',
};

// Espresso machine, 26x32. Its spout (cols 23-24) is where cups get filled.
// prettier-ignore
const MACHINE = pad(26, [
  '..kkkk.kkkk',
  '..kWWk.kWWk',
  '..kffk.kffk',
  'kkkkkkkkkkkkkkkkkkkk',
  'kWssssssssssssssssdk',
  'kkkkkkkkkkkkkkkkkkkk',
  '.kWRRRRRRRRRRRRRRBk',
  '.kWRRRRRRRRRRkkRRBk',
  '.kRRRRRRRRRRkWWkRBk',
  '.kRRRRRRRRRRkWkkRBk',
  '.kRRRRRRRRRRRkkRRBk',
  '.kRRRRRRRRRRRRRRRBk',
  '.kRRRRWRWRRRRRRRRBk',
  '.kRRRWWWWWRRRRRRRBkkkkkkk',
  '.kRRRRWWWRRRRRRRRBssssssdk',
  '.kRRRRRWRRRRRRRRRBkkkkkddk',
  '.kRRRRRRRRRRRRRRRBk...kddk',
  '.kRRRRRRRRRRRRRRRBk....kk',
  '.kRRRRRRRRRRRRRRRBk',
  '.kkkkkkkkkkkkkkkkkk',
  '.kWssssssssssssssdk',
  '.kddddddddddddddddk',
  '.kkkkkkkkkkkkkkkkkk',
  '.kRRRRRRRRRRRRRRRBk',
  '.kRRRRRRRRRRRRRRRBk',
  '.kBBBBBBBBBBBBBBBBk',
  '.kkkkkkkkkkkkkkkkkk',
  'kkkkkkkkkkkkkkkkkkkk',
  'kttttttttttttttttttk',
  'kccccccccccccccccccck',
  'kwwwwwwwwwwwwwwwwwwk',
  'kkkkkkkkkkkkkkkkkkkk',
]);

/** Spout outlet, machine-local: where the drip into a waiting cup starts. */
export const SPOUT = { x: 23, y: 18 };

// Potted plant, 14x18.
// prettier-ignore
const PLANT = [
  '......kk......',
  '..kk.kGGk.....',
  '.kGGkkGmk.kk..',
  '.kGmmkGmkkGGk.',
  '..kGmmkmkGmmk.',
  '...kkGmmGmmk..',
  '..kGGkmmmkk...',
  '.kGmmmkmkGk...',
  '..kkkkkmkmk...',
  '......kmk.....',
  '..kkkkkkkkkk..',
  '..kttttttttk..',
  '..kkkkkkkkkk..',
  '...kccccwwk...',
  '...ktccccwk...',
  '...kccccwwk...',
  '...kccccwwk...',
  '....kkkkkk....',
];

// Lemon half-wheel sitting on the rim, 13x8.
// prettier-ignore
const LEMON = [
  '....kkkkk....',
  '..kkyyyyykk..',
  '.kyyWWWWWyyk.',
  '.kyWyyWyyWtk.',
  'kyWyWyWyWyWtk',
  'kyWyyWWWyyWtk',
  'kyWWWWWWWWWtk',
  'kkkkkkkkkkkkk',
];

export const MACHINE_RUNS: Run[] = toRuns(MACHINE, PROPS);
export const MACHINE_SIZE = { w: 26, h: MACHINE.length };
export const PLANT_RUNS: Run[] = toRuns(PLANT, PROPS);
export const PLANT_SIZE = { w: 14, h: PLANT.length };
export const LEMON_RUNS: Run[] = toRuns(LEMON, PROPS);
export const LEMON_SIZE = { w: 13, h: LEMON.length };

/**
 * A rounded dollop of cream `w` wide and `h` tall: ink outline, white body,
 * foam shade along the lower right.
 */
function dollop(w: number, h: number): string[] {
  const rows: string[] = [];
  const cy = (h - 1) / 2;
  const half = (r: number) => {
    const t = (r - cy) / (h / 2);
    return Math.round((w / 2) * Math.sqrt(Math.max(0, 1 - t * t * t * t)));
  };
  for (let r = 0; r < h; r++) {
    const hw = Math.max(1, half(r));
    const x0 = Math.floor(w / 2) - hw;
    const x1 = Math.floor(w / 2) + hw - 1;
    const prev = r > 0 ? Math.max(1, half(r - 1)) : 0;
    const next = r < h - 1 ? Math.max(1, half(r + 1)) : 0;
    let row = '';
    for (let x = 0; x < w; x++) {
      if (x < x0 || x > x1) row += '.';
      else if (r === 0 || r === h - 1 || x === x0 || x === x1) row += 'k';
      else if (Math.abs(x - Math.floor(w / 2)) >= Math.min(prev, next)) row += 'k';
      else if (x >= x1 - 2 || r === h - 2) row += 'f';
      else row += 'W';
    }
    rows.push(row);
  }
  return rows;
}

function centred(rows: string[], width: number, dx = 0): string[] {
  const pad = Math.floor((width - rows[0].length) / 2) + dx;
  return rows.map((row) => '.'.repeat(pad) + row + '.'.repeat(width - pad - row.length));
}

/**
 * Whipped cream, `width` wide: three rounded dollops stacked so their outlines
 * leave creases, topped with a little curl. Row 0 is the top of the curl.
 */
export function creamRuns(width: number, ox: number, oy: number): Run[] {
  const height = 17;
  let rows = Array<string>(height).fill('.'.repeat(width));
  const tiers: [rows: string[], y: number, dx: number][] = [
    [dollop(width, 8), 9, 0],
    [dollop(width - 10, 7), 5, 0],
    [dollop(width - 22, 6), 2, 1],
  ];
  for (const [tier, y, dx] of tiers) rows = over(rows, centred(tier, width, dx), 0, y);
  const cx = Math.floor(width / 2) + 1;
  rows = over(rows, ['..kk.', '.kWWk', 'kWWfk', 'kWfk.'], cx - 2, 0);
  rows = over(rows, ['WW'], Math.floor(width / 2) - 12, 7);
  rows = over(rows, ['WWW'], Math.floor(width / 2) - 18, 11);
  return toRuns(rows, PROPS, ox, oy);
}

/** Milk foam that sits on top of the liquid, `width` wide and 7 rows tall. */
export function foamRuns(width: number, ox: number, oy: number): Run[] {
  const bumps = Array.from({ length: width }, (_, x) => (x % 6 < 4 ? 'W' : '.')).join('');
  const top = Array.from({ length: width }, (_, x) => (x % 6 === 1 ? 'W' : 'f')).join('');
  const body = 'f'.repeat(width);
  const speckle = Array.from({ length: width }, (_, x) => (x % 11 === 4 ? 't' : 'f')).join('');
  const crema = 'y'.repeat(width);
  return toRuns([bumps, top, body, speckle, body, crema], PROPS, ox, oy);
}
