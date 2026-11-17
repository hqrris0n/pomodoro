import { load, save } from '../storage';
import type { TimerState } from '../types';
import { newTimer, paused, resumed, snapshot, type TimerView } from './schedule';

const KEY = 'timer';
const TICK_MS = 250;

type Opts = { focusMin: number; breakMin: number; rounds: number };
type Phase = TimerView['phase'];

function isState(v: unknown): v is TimerState {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.focusMs === 'number' &&
    typeof s.breakMs === 'number' &&
    typeof s.rounds === 'number' &&
    typeof s.elapsedMs === 'number' &&
    (s.anchorAt === null || typeof s.anchorAt === 'number')
  );
}

export class TimerEngine {
  state = $state.raw<TimerState | null>(null);
  #now = $state(Date.now());
  view = $derived<TimerView | null>(this.state ? snapshot(this.state, this.#now) : null);

  #offset = 0;
  #interval: ReturnType<typeof setInterval> | null = null;
  #lastPhase: Phase | null = null;
  #changeFns = [] as ((state: TimerState | null) => void)[];
  #phaseFns = [] as ((from: Phase, to: Phase, view: TimerView) => void)[];

  constructor() {
    const saved = load<unknown>(KEY, null);
    if (isState(saved)) this.state = saved;
    this.#now = this.#clock();
    this.#settle();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.#tick();
      });
    }
  }

  #clock(): number {
    return Date.now() + this.#offset;
  }

  /** Re-read the clock, record the current phase silently, and (re)arm the interval. */
  #settle() {
    this.#now = this.#clock();
    this.#lastPhase = this.state ? snapshot(this.state, this.#now).phase : null;
    this.#arm();
  }

  #arm() {
    const needed = this.#lastPhase !== null && this.view?.running === true;
    if (needed && this.#interval === null) {
      this.#interval = setInterval(() => this.#tick(), TICK_MS);
    } else if (!needed && this.#interval !== null) {
      clearInterval(this.#interval);
      this.#interval = null;
    }
  }

  #tick() {
    if (!this.state) return;
    this.#now = this.#clock();
    const view = snapshot(this.state, this.#now);
    const from = this.#lastPhase;
    this.#lastPhase = view.phase;
    if (from !== null && from !== view.phase) {
      for (const fn of this.#phaseFns) fn(from, view.phase, view);
    }
    this.#arm();
  }

  #set(next: TimerState | null, notify: boolean) {
    this.state = next;
    save(KEY, next);
    this.#settle();
    if (notify) for (const fn of this.#changeFns) fn(next);
  }

  start(opts: Opts) {
    this.#set(newTimer(opts, this.#clock()), true);
  }

  pause() {
    if (this.state) this.#set(paused(this.state, this.#clock()), true);
  }

  resume() {
    if (this.state) this.#set(resumed(this.state, this.#clock()), true);
  }

  stop() {
    this.#set(null, true);
  }

  restart() {
    if (!this.state) return;
    const { focusMs, breakMs, rounds } = this.state;
    this.start({ focusMin: focusMs / 60_000, breakMin: breakMs / 60_000, rounds });
  }

  apply(state: TimerState | null) {
    this.#set(state, false);
  }

  setClockOffset(ms: number) {
    this.#offset = ms;
    this.#settle();
  }

  onChange(fn: (state: TimerState | null) => void): () => void {
    this.#changeFns.push(fn);
    return () => {
      this.#changeFns = this.#changeFns.filter((f) => f !== fn);
    };
  }

  onPhaseChange(fn: (from: Phase, to: Phase, view: TimerView) => void): () => void {
    this.#phaseFns.push(fn);
    return () => {
      this.#phaseFns = this.#phaseFns.filter((f) => f !== fn);
    };
  }

  /** Run fn with the current view now and whenever it changes; returns a cleanup. */
  watchView(fn: (view: TimerView | null) => void): () => void {
    return $effect.root(() => {
      $effect(() => fn(this.view));
    });
  }
}

export const timer = new TimerEngine();
