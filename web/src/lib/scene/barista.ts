// Barista sprite frames (16x16 each), laid out left to right in one strip.
// A barista shows one frame through a 16x16 window; animations pick a pair of
// frames (`Pair`) and flip between its two members with steps().
//
// Colour keys: k ink, b body, s body shade, h body light, r cheek,
// w apron, f apron shade, c cup, d drink.
import { mirror, over, raise, toRuns, type Palette, type Run } from './pixels';

export const BARISTA_SIZE = 16;

// prettier-ignore
const BODY = [
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kkhhbbbbkk...',
  '..khhbbbbbbbsk..',
  '.khbbbbbbbbbbsk.',
  '.kbbbbbbbbbbbsk.',
  '.kbbbbbbbbbbbsk.',
  '.kbbwwwwwwwwbsk.',
  '.kbbwwwwwwwwssk.',
  '..kbwwffffwwsk..',
  '...kswwwwwwsk...',
  '....kkkkkkkk....',
  '................',
];

// prettier-ignore
const BACK = [
  '................',
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kkhhbbbbkk...',
  '..khhbbbbbbbsk..',
  '.khbbbbbbbbbbsk.',
  '.kbbbbbbbbbbbsk.',
  '.kbbbbbbbbbbbsk.',
  '.kbbbbbbbbbbbsk.',
  '.kbbbbbbbbbbssk.',
  '..kbbbwffwbbsk..',
  '...ksbwbbwbsk...',
  '....kkkkkkkk....',
  '................',
];

const at = (y: number, rows: string[]) => [...Array<string>(y).fill('.'.repeat(16)), ...rows];

const FACE_FRONT = at(7, ['.....k....k.....', '.....k....k.....', '...rr..kk..rr...']);
const FACE_BLINK = at(7, ['................', '.....k....k.....', '...rr..kk..rr...']);
const FACE_HAPPY = at(7, ['.....k....k.....', '....k.k..k.k....', '...rr..kk..rr...']);
const FACE_SIDE = at(7, ['........k..k....', '........k..k....', '......rr.kk.rr..']);

const CUP_FULL = at(9, [
  '............kkkk',
  '............kddk',
  '............kcck',
  '............kkkk',
]);
const CUP_EMPTY = at(9, [
  '............kkkk',
  '............kcck',
  '............kcck',
  '............kkkk',
]);
// Held up and tipped to the left; the spill (cols 0-1) meets the stream that
// Glass.svelte draws from the row below the frame.
const POUR_A = at(3, [
  '.kkkk...........',
  'ddcck...........',
  'ddcck...........',
  '.kkkk...........',
  'dd..............',
  'dd..............',
]);
const POUR_B = at(4, [
  '.kkkk...........',
  'ddcck...........',
  'ddcck...........',
  '.kkkk...........',
  'dd..............',
]);
const HEAD_CUP_FULL = at(1, ['.....kkkkkk.....', '.....kddddk.....', '.....kcccck.....']);
const HEAD_CUP_EMPTY = at(1, ['.....kkkkkk.....', '.....kcccck.....', '.....kcccck.....']);

const FEET_STAND = at(15, ['....kk....kk....']);
const FEET_STRIDE = at(15, ['...kk......kk...']);
const FEET_PASS = at(14, ['......k..k......', '......kk.kk.....']);
const FEET_CLIMB = at(15, ['..........kk....']);

const ARMS_CLIMB = at(3, [
  '.kk.............',
  '.kbk............',
  '..k.............',
  '................',
  '................',
  '...............k',
  '..............bk',
  '...............k',
]);
const MOUTH_OPEN = at(9, ['.......kk.......', '.......kk.......']);

function compose(...layers: string[][]): string[] {
  return layers.reduce((acc, layer) => over(acc, layer));
}

const walkRight = (cup: string[]) => [
  compose(BODY, FACE_SIDE, cup, FEET_STRIDE),
  compose(raise(compose(BODY, FACE_SIDE, cup), 1), FEET_PASS),
];

const walkLeft = (cup: string[]) => [
  compose(BODY, mirror(FACE_SIDE), mirror(cup), mirror(FEET_STRIDE)),
  compose(raise(compose(BODY, mirror(FACE_SIDE), mirror(cup)), 1), mirror(FEET_PASS)),
];

const climb = (cup: string[]) => [
  compose(BACK, cup, ARMS_CLIMB, FEET_CLIMB),
  compose(BACK, cup, mirror(ARMS_CLIMB), mirror(FEET_CLIMB)),
];

const standLeft = (cup: string[]) => {
  const frame = compose(BODY, mirror(FACE_SIDE), mirror(cup), FEET_STAND);
  return [frame, frame];
};

/** Frame pairs, by name, in strip order. */
const PAIRS = {
  walkFull: walkRight(CUP_FULL),
  walkEmpty: walkLeft(CUP_EMPTY),
  climbUp: climb(HEAD_CUP_FULL),
  climbDown: climb(HEAD_CUP_EMPTY),
  pour: [
    compose(BODY, mirror(FACE_SIDE), POUR_A, FEET_STAND),
    compose(BODY, mirror(FACE_SIDE), POUR_B, FEET_STAND),
  ],
  fillEmpty: standLeft(CUP_EMPTY),
  fillFull: standLeft(CUP_FULL),
  idle: [compose(BODY, FACE_FRONT, FEET_STAND), compose(BODY, FACE_BLINK, FEET_STAND)],
  cheer: [compose(BODY, FACE_HAPPY, FEET_STAND), compose(BODY, FACE_HAPPY, MOUTH_OPEN, FEET_PASS)],
} satisfies Record<string, string[][]>;

export type Pair = keyof typeof PAIRS;

const ORDER = Object.keys(PAIRS) as Pair[];

/** x offset (in grid units) of a pair's first frame inside the strip. */
export function pairOffset(pair: Pair): number {
  return ORDER.indexOf(pair) * 2 * BARISTA_SIZE;
}

export const BARISTA_PALETTE: Palette = {
  k: 'var(--ink)',
  b: 'var(--b-base)',
  s: 'var(--b-shade)',
  h: 'var(--b-light)',
  r: 'var(--b-cheek)',
  w: 'var(--b-apron)',
  f: 'var(--b-apron-shade)',
  c: 'var(--white)',
  d: 'var(--drink)',
};

/** Every frame, as merged runs on one long strip. */
export const STRIP: Run[] = ORDER.flatMap((pair, p) =>
  PAIRS[pair].flatMap((frame, f) => toRuns(frame, BARISTA_PALETTE, (p * 2 + f) * BARISTA_SIZE, 0)),
);

export const STRIP_WIDTH = ORDER.length * 2 * BARISTA_SIZE;

/** Colour sets for the four baristas (CSS variables for the palette keys above). */
export const CREW = [
  {
    name: 'strawberry',
    base: '--strawberry',
    shade: '--berry',
    light: '--foam',
    cheek: '--berry',
    apron: '--white',
    apronShade: '--foam',
  },
  {
    name: 'matcha',
    base: '--matcha',
    shade: '--moss',
    light: '--butter',
    cheek: '--strawberry',
    apron: '--foam',
    apronShade: '--toffee',
  },
  {
    name: 'sky',
    base: '--sky',
    shade: '--dusk',
    light: '--white',
    cheek: '--strawberry',
    apron: '--butter',
    apronShade: '--toffee',
  },
  {
    name: 'butter',
    base: '--butter',
    shade: '--toffee',
    light: '--white',
    cheek: '--strawberry',
    apron: '--sky',
    apronShade: '--dusk',
  },
] as const;
