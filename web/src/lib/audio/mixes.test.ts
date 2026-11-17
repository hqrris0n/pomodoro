import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mix } from '../types';
import { SoundStore } from './mixes.svelte';

function stubEngine() {
  const mixes: Mix[] = [];
  return {
    mixes,
    unlock: vi.fn(async () => {}),
    setChannels: vi.fn(),
    setMix: vi.fn((m: Mix) => void mixes.push(m)),
    setMaster: vi.fn(),
    setMuted: vi.fn(),
    playChime: vi.fn(async () => {}),
  };
}

const make = () => {
  const engine = stubEngine();
  return { engine, store: new SoundStore(engine) };
};

beforeEach(() => localStorage.clear());

describe('SoundStore state', () => {
  it('starts disabled and sends an empty mix on a first visit', () => {
    const { engine, store } = make();
    expect(store.enabled).toBe(false);
    expect(store.master).toBe(0.8);
    expect(store.saved.map((s) => s.name)).toEqual(['Quiet morning', 'Busy café', 'Rainy day']);
    expect(engine.mixes.at(-1)).toEqual({});
  });

  it('loading Rainy day enables sound and marks it active; a slider change clears it', () => {
    const { engine, store } = make();
    const rainy = store.saved.find((s) => s.name === 'Rainy day')!;
    store.loadSaved(rainy.id);
    expect(store.enabled).toBe(true);
    expect(store.mix).toEqual({ rain: 0.7, fireplace: 0.4, hum: 0.2 });
    expect(store.activeSavedId).toBe(rainy.id);
    expect(engine.mixes.at(-1)).toEqual({ rain: 0.7, fireplace: 0.4, hum: 0.2 });
    store.setVolume('rain', 0.6);
    expect(store.activeSavedId).toBeNull();
  });

  it('enables on any volume above zero and drops zero entries', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    expect(store.enabled).toBe(true);
    store.setVolume('rain', 0);
    expect(store.mix).toEqual({});
  });

  it('applyMix replaces levels and enables only when audible', () => {
    const { store } = make();
    store.applyMix({});
    expect(store.enabled).toBe(false);
    store.applyMix({ wind: 0.3 });
    expect(store.enabled).toBe(true);
    store.applyMix({ rain: 0.2 });
    expect(store.mix).toEqual({ rain: 0.2 });
  });

  it('sends nothing audible when disabled, keeps the mix', () => {
    const { engine, store } = make();
    store.setVolume('rain', 0.5);
    store.setEnabled(false);
    expect(engine.mixes.at(-1)).toEqual({});
    expect(store.mix).toEqual({ rain: 0.5 });
  });

  it('forwards unlock and master/mute', async () => {
    const { engine, store } = make();
    await store.unlock();
    expect(engine.unlock).toHaveBeenCalled();
    store.setMaster(0.3);
    store.toggleMuted();
    expect(engine.setMaster).toHaveBeenLastCalledWith(0.3);
    expect(engine.setMuted).toHaveBeenLastCalledWith(true);
  });
});

describe('SoundStore saved mixes', () => {
  it('rejects empty, built-in, and over-long names', () => {
    const { store } = make();
    expect(store.saveCurrent('  ')).toBe('Give the mix a name.');
    expect(store.saveCurrent('rainy day')).toBe('That name is taken by a built-in mix.');
    expect(store.saveCurrent('x'.repeat(31))).not.toBeNull();
    expect(store.saved).toHaveLength(3);
  });

  it('overwrites a same-named user mix', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    expect(store.saveCurrent('Mine')).toBeNull();
    store.setVolume('rain', 0.9);
    expect(store.saveCurrent(' mine ')).toBeNull();
    const user = store.saved.filter((s) => !s.builtIn);
    expect(user).toHaveLength(1);
    expect(user[0].mix).toEqual({ rain: 0.9 });
  });

  it('renames and deletes user mixes but not built-ins', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    store.saveCurrent('Mine');
    const mine = store.saved.find((s) => !s.builtIn)!;
    const builtIn = store.saved[0];

    store.renameSaved(builtIn.id, 'Other');
    store.deleteSaved(builtIn.id);
    expect(store.saved[0].name).toBe('Quiet morning');
    expect(store.saved).toHaveLength(4);

    expect(store.renameSaved(mine.id, 'Renamed')).toBeNull();
    expect(store.saved.find((s) => s.id === mine.id)!.name).toBe('Renamed');
    expect(store.renameSaved(mine.id, 'Busy café')).toBe('That name is taken by a built-in mix.');
    store.deleteSaved(mine.id);
    expect(store.saved).toHaveLength(3);
  });

  it('persists levels and user mixes across stores', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    store.setMaster(0.4);
    store.toggleMuted();
    store.saveCurrent('Mine');
    const { store: again, engine } = make();
    expect(again.mix).toEqual({ rain: 0.5 });
    expect(again.master).toBe(0.4);
    expect(again.muted).toBe(true);
    expect(again.enabled).toBe(true);
    expect(again.saved.filter((s) => !s.builtIn).map((s) => s.name)).toEqual(['Mine']);
    expect(engine.mixes.at(-1)).toEqual({ rain: 0.5 });
  });
});
