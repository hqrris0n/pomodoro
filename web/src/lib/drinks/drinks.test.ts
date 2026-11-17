import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Drink } from '../types';
import { DrinkStore, isDrink } from './drinks.svelte';

// The real files in public/drinks, read as text at test time.
const files = import.meta.glob<string>('/public/drinks/*', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const fileText = (name: string): string => files[`/public/drinks/${name}`];
const hasFile = (name: string): boolean => `/public/drinks/${name}` in files;
const IDS = [
  'latte',
  'iced-americano',
  'matcha-latte',
  'hot-chocolate',
  'strawberry-milk',
  'thai-tea',
  'chai',
  'lemonade',
];
const ERROR = "Couldn't load the drinks menu. Reload the page to try again.";

function drink(id: string): Drink {
  return {
    id,
    name: id.toUpperCase(),
    image: `${id}.svg`,
    glass: {
      layers: [{ color: '#6b4337', share: 1 }],
      ice: false,
      topping: 'foam',
      straw: null,
      hot: true,
    },
  };
}

function mockFetch(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

describe('drinks.json', () => {
  const raw: unknown = JSON.parse(fileText('drinks.json'));

  it('lists the eight launch drinks in order', () => {
    expect(Array.isArray(raw)).toBe(true);
    expect((raw as { id: string }[]).map((d) => d.id)).toEqual(IDS);
  });

  it('has valid entries with existing images and layer shares summing to 1', () => {
    for (const entry of raw as unknown[]) {
      expect(isDrink(entry)).toBe(true);
      const d = entry as Drink;
      expect(hasFile(d.image)).toBe(true);
      const total = d.glass.layers.reduce((sum, layer) => sum + layer.share, 0);
      expect(Math.abs(total - 1)).toBeLessThanOrEqual(0.001);
    }
  });
});

describe('isDrink', () => {
  it('accepts a complete drink', () => {
    expect(isDrink(drink('latte'))).toBe(true);
  });

  it('rejects a missing glass, non-array layers or unknown topping', () => {
    const base = drink('a');
    expect(isDrink({ id: base.id, name: base.name, image: base.image })).toBe(false);
    expect(isDrink({ ...base, glass: { ...base.glass, layers: 'x' } })).toBe(false);
    expect(isDrink({ ...base, glass: { ...base.glass, layers: [] } })).toBe(false);
    expect(isDrink({ ...base, glass: { ...base.glass, topping: 'sprinkles' } })).toBe(false);
  });
});

describe('DrinkStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('keeps valid drinks, preselects the first and remembers a choice', async () => {
    mockFetch([drink('a'), { id: 'broken' }, drink('b')]);
    const store = new DrinkStore();
    await store.load();
    expect(store.list.map((d) => d.id)).toEqual(['a', 'b']);
    expect(store.error).toBeNull();
    expect(store.selected?.id).toBe('a');

    store.select('nope');
    expect(store.selected?.id).toBe('a');
    store.select('b');

    const next = new DrinkStore();
    await next.load();
    expect(next.selected?.id).toBe('b');
  });

  it('falls back to the first drink when the saved id is gone', async () => {
    localStorage.setItem('cafe:drink', JSON.stringify('gone'));
    mockFetch([drink('a'), drink('b')]);
    const store = new DrinkStore();
    await store.load();
    expect(store.selected?.id).toBe('a');
  });

  it('fetches only once', async () => {
    mockFetch([drink('a')]);
    const store = new DrinkStore();
    await Promise.all([store.load(), store.load()]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the fetch fails or nothing is valid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const failed = new DrinkStore();
    await failed.load();
    expect(failed.error).toBe(ERROR);
    expect(failed.selected).toBeNull();

    mockFetch([{ id: 'broken' }]);
    const empty = new DrinkStore();
    await empty.load();
    expect(empty.error).toBe(ERROR);
  });

  it('builds image urls under the base path', () => {
    expect(new DrinkStore().imageUrl(drink('latte'))).toBe(
      `${import.meta.env.BASE_URL}drinks/latte.svg`,
    );
  });
});

describe('sprites', () => {
  it('has one sprite per drink', () => {
    const svgs = Object.keys(files)
      .filter((f) => f.endsWith('.svg'))
      .map((f) => f.slice('/public/drinks/'.length));
    expect(svgs.sort()).toEqual(IDS.map((id) => `${id}.svg`).sort());
  });

  it.each(IDS)('%s uses only rects on integer coordinates', (id) => {
    const svg = fileText(`${id}.svg`);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const root = doc.documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 32 48');
    for (const el of Array.from(root.querySelectorAll('*'))) {
      expect(['rect', 'g']).toContain(el.tagName);
      if (el.tagName !== 'rect') continue;
      for (const attr of ['x', 'y', 'width', 'height']) {
        expect(el.getAttribute(attr)).toMatch(/^\d+$/);
      }
    }
  });
});
