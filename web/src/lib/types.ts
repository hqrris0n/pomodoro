// Types shared between features. The room-related ones mirror docs/protocol.md.

/** A timer is a pure function of elapsed time; see lib/timer. */
export type TimerState = {
  /** Length of one focus round, whole minutes in ms (60_000 .. 10_800_000). */
  focusMs: number;
  /** Length of a break (300_000 | 600_000 | 900_000). Ignored when rounds is 1. */
  breakMs: number;
  /** Number of focus rounds, 1 .. 6. */
  rounds: number;
  /** Elapsed time at the moment of `anchorAt`, or the frozen value while paused. */
  elapsedMs: number;
  /** Epoch ms when the timer last started running; null while paused. */
  anchorAt: number | null;
};

/** One entry of public/drinks/drinks.json. */
export type Drink = {
  id: string;
  name: string;
  /** Sprite file name inside public/drinks/, e.g. "latte.svg". */
  image: string;
  /** How the big glass on the timer screen is drawn for this drink. */
  glass: {
    /** Liquid bands from bottom to top; shares sum to 1. Colours are hex. */
    layers: { color: string; share: number }[];
    ice: boolean;
    topping: 'none' | 'foam' | 'cream' | 'lemon';
    /** Straw colour (hex), or null for no straw. */
    straw: string | null;
    /** Hot drinks steam when full. */
    hot: boolean;
  };
};

/** One entry of public/sounds/sounds.json. */
export type SoundChannel = {
  id: string;
  name: string;
  /** Audio file name inside public/sounds/, e.g. "rain.mp3". */
  file: string;
};

/** Channel id -> volume 0..1. A missing or zero entry means the channel is off. */
export type Mix = Record<string, number>;

/** A saved sound mix: a named channel mix. */
export type SavedMix = { id: string; name: string; mix: Mix };

/** Everything a room shares besides the timer. */
export type Settings = {
  drinkId: string;
  backgroundId: string;
  /** Minutes between automatic background changes; 0 = off. */
  backgroundRotateMin: number;
  mix: Mix;
  /**
   * The host's saved mixes. Rooms always carry it; a patch that leaves it out
   * keeps the room's list.
   */
  mixes?: SavedMix[];
};

/**
 * What a settings patch carries: only fields that changed. In `mix`, each key
 * sets that channel's level and 0 removes the channel; absent channels stay.
 */
export type SettingsPatch = Partial<Omit<Settings, 'mix'>> & { mix?: Mix };
