// Scene geometry, in grid units. One unit is one art pixel.

export const SCENE = { w: 160, h: 100 } as const;

/** First row of the counter; everything stands on row COUNTER_Y - 1. */
export const COUNTER_Y = 86;

/** Big glass: 48x72, standing on the counter. */
export const GLASS = { x: 56, y: COUNTER_Y - 72, w: 48, h: 72 } as const;

/** Liquid rows inside the glass (local y), top..bottom exclusive. */
export const LIQUID_TOP = 4;
export const LIQUID_BOTTOM = 64;
export const LIQUID_HEIGHT = LIQUID_BOTTOM - LIQUID_TOP;

/** The glass walls step inwards by one pixel per side every 24 rows. */
export const TAPER = [
  { from: 0, to: 24, inset: 0 },
  { from: 24, to: 48, inset: 1 },
  { from: 48, to: 72, inset: 2 },
] as const;

/** Ladder standing against the glass's right wall. */
export const LADDER = { x: 104, w: 12, top: 10 } as const;
export const RUNG_GAP = 6;
export const TOP_RUNG = 20;

/** Barista route (sprite top-left corners). Steps in Barista.svelte follow these. */
export const ROUTE = {
  machineX: 22,
  ladderX: 102,
  pourX: 98,
  groundY: COUNTER_Y - 16,
  topY: TOP_RUNG - 16,
} as const;

/** Where baristas stand when they are not working (also the reduced-motion pose). */
export const REST = [
  { x: 22, y: ROUTE.groundY },
  { x: 38, y: ROUTE.groundY },
  { x: 117, y: ROUTE.groundY },
  { x: 132, y: ROUTE.groundY },
] as const;

/** One full barista loop, and the stagger between baristas. */
export const LOOP_S = 20;
export const STAGGER_S = LOOP_S / 4;
