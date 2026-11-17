import { load as loadSaved, save } from '../storage';
import type { Drink } from '../types';

const TOPPINGS = ['none', 'foam', 'cream', 'lemon'];
const LOAD_ERROR = "Couldn't load the drinks menu. Reload the page to try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isDrink(value: unknown): value is Drink {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (typeof value.image !== 'string') return false;
  const glass = value.glass;
  if (!isRecord(glass)) return false;
  const layers = glass.layers;
  if (!Array.isArray(layers) || layers.length === 0) return false;
  for (const layer of layers) {
    if (!isRecord(layer)) return false;
    if (typeof layer.color !== 'string') return false;
    if (typeof layer.share !== 'number' || !Number.isFinite(layer.share)) return false;
  }
  if (typeof glass.ice !== 'boolean' || typeof glass.hot !== 'boolean') return false;
  if (typeof glass.topping !== 'string' || !TOPPINGS.includes(glass.topping)) return false;
  return glass.straw === null || typeof glass.straw === 'string';
}

export class DrinkStore {
  list = $state<Drink[]>([]);
  loaded = $state(false);
  error = $state<string | null>(null);
  selectedId = $state(loadSaved<string>('drink', ''));
  #request: Promise<void> | null = null;

  selected = $derived<Drink | null>(
    this.list.find((drink) => drink.id === this.selectedId) ?? this.list[0] ?? null,
  );

  load(): Promise<void> {
    this.#request ??= this.#fetchList();
    return this.#request;
  }

  async #fetchList(): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}drinks/drinks.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('not a list');
      this.list = data.filter(isDrink);
      this.error = this.list.length === 0 ? LOAD_ERROR : null;
    } catch {
      this.error = LOAD_ERROR;
    }
    this.loaded = true;
  }

  select(id: string): void {
    if (!this.list.some((drink) => drink.id === id)) return;
    this.selectedId = id;
    save('drink', id);
  }

  imageUrl(drink: Drink): string {
    return `${import.meta.env.BASE_URL}drinks/${drink.image}`;
  }
}

export const drinks = new DrinkStore();
