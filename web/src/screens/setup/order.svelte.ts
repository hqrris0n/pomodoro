import { load, save } from '../../lib/storage';

const KEY = 'setup';

export const FOCUS_MIN = 1;
export const FOCUS_MAX = 180;
export const ROUNDS_MIN = 1;
export const ROUNDS_MAX = 6;
export const BREAK_CHOICES = [5, 10, 15] as const;

const DEFAULTS = { focusMin: 30, rounds: 1, breakMin: 5 };

function clampInt(n: number, min: number, max: number): number | null {
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isBreak(n: unknown): n is number {
  return BREAK_CHOICES.some((b) => b === n);
}

/** "45 min", "1 h", "1 h 30 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** What the customer is ordering: focus length, rounds, break length. */
export class Order {
  focusMin = $state(DEFAULTS.focusMin);
  rounds = $state(DEFAULTS.rounds);
  breakMin = $state(DEFAULTS.breakMin);

  /** Whole session, counting breaks between rounds but not after the last. */
  totalMin = $derived(this.rounds * this.focusMin + (this.rounds - 1) * this.breakMin);

  constructor() {
    const saved = load<unknown>(KEY, null);
    if (typeof saved !== 'object' || saved === null) return;
    const s = saved as Record<string, unknown>;
    this.focusMin =
      typeof s.focusMin === 'number'
        ? (clampInt(s.focusMin, FOCUS_MIN, FOCUS_MAX) ?? DEFAULTS.focusMin)
        : DEFAULTS.focusMin;
    this.rounds =
      typeof s.rounds === 'number'
        ? (clampInt(s.rounds, ROUNDS_MIN, ROUNDS_MAX) ?? DEFAULTS.rounds)
        : DEFAULTS.rounds;
    this.breakMin = isBreak(s.breakMin) ? s.breakMin : DEFAULTS.breakMin;
  }

  setFocusMin(n: number): void {
    const v = clampInt(n, FOCUS_MIN, FOCUS_MAX);
    if (v === null) return;
    this.focusMin = v;
    this.#save();
  }

  setRounds(n: number): void {
    const v = clampInt(n, ROUNDS_MIN, ROUNDS_MAX);
    if (v === null) return;
    this.rounds = v;
    this.#save();
  }

  setBreakMin(n: number): void {
    if (!isBreak(n)) return;
    this.breakMin = n;
    this.#save();
  }

  #save(): void {
    save(KEY, { focusMin: this.focusMin, rounds: this.rounds, breakMin: this.breakMin });
  }
}

export const order = new Order();
