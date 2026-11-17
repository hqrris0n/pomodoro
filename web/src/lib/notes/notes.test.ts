import { beforeEach, describe, expect, it, vi } from 'vitest';
import { load, save } from '../storage';
import { NoteStore, type Note } from './notes.svelte';

const note = (id: string, text = 'hi'): Note => ({
  id,
  roomId: 'r',
  fromId: 'f',
  fromName: 'Maple Wren',
  text,
  sentAt: 1,
});
const make = () => {
  const player = { effect: vi.fn(async () => {}) };
  return { player, store: new NoteStore(player) };
};

beforeEach(() => localStorage.clear());

describe('NoteStore', () => {
  it('adds, dedupes and dismisses', () => {
    const { store } = make();
    store.add(note('a'));
    store.add(note('b'));
    store.add(note('a', 'again'));
    expect(store.list.map((n) => n.id)).toEqual(['a', 'b']);
    store.dismiss('a');
    expect(store.list.map((n) => n.id)).toEqual(['b']);
  });

  it('plays page quietly once per new note', () => {
    const { store, player } = make();
    store.add(note('a'));
    store.add(note('a'));
    store.add(note('b'));
    expect(player.effect).toHaveBeenCalledTimes(2);
    expect(player.effect).toHaveBeenCalledWith('page', 0.5);
  });

  it('persists across instances and forgets dismissed notes', () => {
    const first = make().store;
    first.add(note('a'));
    first.add(note('b'));
    first.dismiss('a');
    expect(make().store.list.map((n) => n.id)).toEqual(['b']);
  });

  it('ignores garbage in storage', () => {
    save('notes', 'nope');
    expect(make().store.list).toEqual([]);
    save('notes', [note('a'), { id: 3 }, null, note('a'), { ...note('b'), text: 5 }]);
    expect(make().store.list.map((n) => n.id)).toEqual(['a']);
  });

  it('keeps the newest 20', () => {
    const { store } = make();
    for (let i = 0; i < 25; i++) store.add(note(`n${i}`));
    expect(store.list).toHaveLength(20);
    expect(store.list[0].id).toBe('n5');
    expect(load<Note[]>('notes', [])).toHaveLength(20);
  });
});
