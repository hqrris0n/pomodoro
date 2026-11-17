import { flushSync } from 'svelte';
import { load, save } from '../storage';
import { scenes, sceneById } from './registry';

const DEFAULT_ID = scenes[0].id;
const MAX_ROTATE = 120;

function clampRotate(min: number): number {
  if (!Number.isFinite(min)) return 0;
  return Math.min(MAX_ROTATE, Math.max(0, Math.round(min)));
}

export class BackgroundStore {
  #selectedId = $state(DEFAULT_ID);
  #rotateMin = $state(0);
  #listeners: ((id: string) => void)[] = [];

  constructor() {
    const id = load<unknown>('background', DEFAULT_ID);
    if (typeof id === 'string' && scenes.some((s) => s.id === id)) this.#selectedId = id;
    const min = load<unknown>('backgroundRotate', 0);
    if (typeof min === 'number') this.#rotateMin = clampRotate(min);
  }

  get selectedId(): string {
    return this.#selectedId;
  }

  get rotateMin(): number {
    return this.#rotateMin;
  }

  set rotateMin(min: number) {
    this.setRotate(min);
  }

  select(id: string): void {
    if (!scenes.some((s) => s.id === id)) return;
    this.#selectedId = id;
    save('background', id);
  }

  /** A user or automatic change (not room sync): select, then tell listeners if it changed. */
  choose(id: string): void {
    if (!scenes.some((s) => s.id === id) || id === this.#selectedId) return;
    this.select(id);
    for (const fn of [...this.#listeners]) fn(id);
  }

  /** Listen for choose() and next() changes. Returns unsubscribe. */
  onChoose(fn: (id: string) => void): () => void {
    this.#listeners.push(fn);
    return () => {
      this.#listeners = this.#listeners.filter((f) => f !== fn);
    };
  }

  setRotate(min: number): void {
    this.#rotateMin = clampRotate(min);
    save('backgroundRotate', this.#rotateMin);
  }

  next(): void {
    const i = scenes.indexOf(sceneById(this.#selectedId));
    this.choose(scenes[(i + 1) % scenes.length].id);
  }

  /** While rotateMin > 0, call next() every rotateMin minutes. Returns stop. */
  startRotation(): () => void {
    const stop = $effect.root(() => {
      $effect(() => {
        const min = this.#rotateMin;
        if (min <= 0) return;
        const timer = setInterval(() => this.next(), min * 60_000);
        return () => clearInterval(timer);
      });
    });
    flushSync();
    return stop;
  }
}

export const backgrounds = new BackgroundStore();
