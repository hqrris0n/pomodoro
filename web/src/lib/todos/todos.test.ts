import { beforeEach, describe, expect, it } from 'vitest';
import { TodoStore } from './todos.svelte';

const texts = (s: TodoStore) => s.items.map((t) => t.text);

describe('TodoStore', () => {
  let store: TodoStore;
  beforeEach(() => {
    localStorage.clear();
    store = new TodoStore();
  });

  it('trims text and ignores blank input', () => {
    store.add('  buy beans  ');
    store.add('   ');
    expect(texts(store)).toEqual(['buy beans']);
    expect(store.items[0].done).toBe(false);
  });

  it('truncates to 120 characters', () => {
    store.add('x'.repeat(200));
    expect(store.items[0].text).toHaveLength(120);
  });

  it('toggles, removes and clears completed while tracking remaining', () => {
    ['a', 'b', 'c'].forEach((t) => store.add(t));
    expect(store.remaining).toBe(3);
    store.toggle(store.items[0].id);
    store.toggle(store.items[1].id);
    expect(store.remaining).toBe(1);
    store.toggle(store.items[1].id);
    expect(store.remaining).toBe(2);
    store.clearCompleted();
    expect(texts(store)).toEqual(['b', 'c']);
    store.remove(store.items[0].id);
    expect(texts(store)).toEqual(['c']);
    expect(store.remaining).toBe(1);
  });

  it('moves an item', () => {
    ['a', 'b', 'c'].forEach((t) => store.add(t));
    store.move(0, 2);
    expect(texts(store)).toEqual(['b', 'c', 'a']);
    expect(store.remaining).toBe(3);
  });

  it('restores items in order in a new store', () => {
    ['a', 'b', 'c'].forEach((t) => store.add(t));
    store.toggle(store.items[1].id);
    store.move(0, 2);
    const restored = new TodoStore();
    expect(JSON.parse(JSON.stringify(restored.items))).toEqual(
      JSON.parse(JSON.stringify(store.items)),
    );
    expect(restored.remaining).toBe(2);
  });
});
