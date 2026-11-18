import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mix, SavedMix } from '../types';
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

  it('loading Rainy day leaves sound alone and marks it active; a slider change clears it', () => {
    const { engine, store } = make();
    const rainy = store.saved.find((s) => s.name === 'Rainy day')!;
    store.loadSaved(rainy.id);
    expect(store.enabled).toBe(false);
    expect(store.mix).toEqual({ rain: 0.7, fireplace: 0.4, hum: 0.2 });
    expect(store.activeSavedId).toBe(rainy.id);
    expect(engine.mixes.at(-1)).toEqual({});
    store.setEnabled(true);
    expect(engine.mixes.at(-1)).toEqual({ rain: 0.7, fireplace: 0.4, hum: 0.2 });
    store.setVolume('rain', 0.6);
    expect(store.activeSavedId).toBeNull();
  });

  it('setVolume drops zero entries and keeps the remembered level', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    store.setVolume('rain', 0);
    expect(store.mix).toEqual({});
    expect(store.levels.rain).toBe(0.5);
    store.setVolume('rain', 0.3);
    store.setVolume('rain', 0);
    expect(store.enabled).toBe(true);
  });

  it('mute and the Sound switch are one setting', () => {
    const { engine, store } = make();
    expect(store.muted).toBe(true);
    store.setEnabled(true);
    expect(store.muted).toBe(false);
    expect(engine.setMuted).toHaveBeenLastCalledWith(false);
    store.toggleMuted();
    expect(store.enabled).toBe(false);
    expect(engine.setMuted).toHaveBeenLastCalledWith(true);
    store.toggleMuted();
    expect(store.enabled).toBe(true);
  });

  it('moving the overall volume or a channel level turns sound on', () => {
    const { store } = make();
    store.setMaster(0.5);
    expect(store.enabled).toBe(true);
    store.setEnabled(false);
    store.setVolume('rain', 0.4);
    expect(store.enabled).toBe(true);
  });

  it('loads old saved prefs as on only if enabled and not muted', () => {
    const load = (p: object) => {
      localStorage.setItem('cafe:sound', JSON.stringify(p));
      return make().store.enabled;
    };
    expect(load({ enabled: true, muted: false })).toBe(true);
    expect(load({ enabled: true, muted: true })).toBe(false);
    expect(load({ enabled: false, muted: false })).toBe(false);
  });

  it('switching a channel off and on restores its level; default is 50%', () => {
    const { engine, store } = make();
    store.applyMix({ rain: 0.7 });
    store.setChannelOn('rain', false);
    expect(store.mix).toEqual({});
    expect(engine.mixes.at(-1)).toEqual({});
    store.setChannelOn('rain', true);
    expect(store.mix).toEqual({ rain: 0.7 });
    store.setChannelOn('wind', true);
    expect(store.mix).toEqual({ rain: 0.7, wind: 0.5 });
    expect(store.enabled).toBe(false); // switching a channel never touches the Sound setting
  });

  it('applyMix replaces levels without touching enabled; absent channels keep their memory', () => {
    const { store } = make();
    store.applyMix({ wind: 0.3 });
    expect(store.enabled).toBe(false);
    store.applyMix({ rain: 0.2 });
    expect(store.mix).toEqual({ rain: 0.2 });
    expect(store.levels).toEqual({ wind: 0.3, rain: 0.2 });
    store.setEnabled(true);
    store.applyMix({});
    expect(store.enabled).toBe(true);
  });

  it('effect plays the named file through the engine', async () => {
    const { engine, store } = make();
    await store.effect('pop');
    expect(engine.playChime).toHaveBeenLastCalledWith(
      `${import.meta.env.BASE_URL}sounds/pop.mp3`,
      1,
    );
    await store.effect('page', 0.5);
    expect(engine.playChime).toHaveBeenLastCalledWith(
      `${import.meta.env.BASE_URL}sounds/page.mp3`,
      0.5,
    );
    await store.chime();
    expect(engine.playChime).toHaveBeenLastCalledWith(
      `${import.meta.env.BASE_URL}sounds/chime.mp3`,
      1,
    );
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
    expect(engine.setMaster).toHaveBeenLastCalledWith(0.3);
    expect(engine.setMuted).toHaveBeenLastCalledWith(false);
  });
});

describe('SoundStore saved mixes', () => {
  it('rejects empty and over-long names', () => {
    const { store } = make();
    expect(store.saveCurrent('  ')).toBe('Give the mix a name.');
    expect(store.saveCurrent('x'.repeat(31))).not.toBeNull();
    expect(store.saved).toHaveLength(3);
  });

  it('overwrites a same-named mix', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    expect(store.saveCurrent('Mine')).toBeNull();
    store.setVolume('rain', 0.9);
    expect(store.saveCurrent(' mine ')).toBeNull();
    const user = store.saved.filter((s) => s.name.toLowerCase() === 'mine');
    expect(user).toHaveLength(1);
    expect(user[0].mix).toEqual({ rain: 0.9 });
    expect(store.saved).toHaveLength(4);
  });

  it('saving under a preset name overwrites the preset in place', () => {
    const { store } = make();
    store.setVolume('rain', 0.9);
    expect(store.saveCurrent('rainy day')).toBeNull();
    expect(store.saved).toHaveLength(3);
    const rainy = store.saved[2];
    expect(rainy.id).toBe('builtin:rainy-day');
    expect(rainy.name).toBe('rainy day');
    expect(rainy.mix).toEqual({ rain: 0.9 });
  });

  it('seeds the three presets on a fresh start and persists them', () => {
    make();
    const stored = JSON.parse(localStorage.getItem('cafe:mixes')!);
    expect(stored.map((m: { id: string }) => m.id)).toEqual([
      'builtin:quiet-morning',
      'builtin:busy-cafe',
      'builtin:rainy-day',
    ]);
    expect(JSON.parse(localStorage.getItem('cafe:presetsSeeded')!)).toBe(true);
  });

  it('renames and deletes presets like any mix, across stores, without re-seeding', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    store.saveCurrent('Mine');
    store.setLink('night-lights', 'builtin:busy-cafe', true);

    expect(store.renameSaved('builtin:quiet-morning', 'Calm')).toBeNull();
    expect(store.renameSaved('builtin:quiet-morning', 'mine')).toBe(
      'Another mix already has that name.',
    );
    store.deleteSaved('builtin:busy-cafe');
    expect(store.links).toEqual({});

    const again = make().store;
    expect(again.saved.map((s) => s.name)).toEqual(['Calm', 'Rainy day', 'Mine']);
    again.deleteSaved('builtin:rainy-day');
    again.deleteSaved('builtin:quiet-morning');
    again.deleteSaved(again.saved[0].id);
    expect(make().store.saved).toEqual([]);
  });

  it('prepends the presets once to existing storage, skipping a name clash', () => {
    localStorage.setItem(
      'cafe:mixes',
      JSON.stringify([{ id: 'u1', name: 'busy CAFÉ', mix: { rain: 0.2 } }]),
    );
    const store = make().store;
    expect(store.saved.map((s) => s.name)).toEqual(['Quiet morning', 'Rainy day', 'busy CAFÉ']);
    store.deleteSaved('builtin:rainy-day');
    expect(make().store.saved.map((s) => s.name)).toEqual(['Quiet morning', 'busy CAFÉ']);
  });

  it('does not seed an existing empty list once the flag is set', () => {
    localStorage.setItem('cafe:mixes', '[]');
    localStorage.setItem('cafe:presetsSeeded', 'true');
    expect(make().store.saved).toEqual([]);
  });

  it('remembers an off channel level across stores and survives garbage', () => {
    const { store } = make();
    store.setVolume('rain', 0.6);
    store.setChannelOn('rain', false);
    expect(make().store.levels).toEqual({ rain: 0.6 });
    localStorage.setItem('cafe:sound', JSON.stringify({ levels: 'x', mix: { a: 2 } }));
    expect(make().store.levels).toEqual({ a: 1 });
  });

  it('persists levels and user mixes across stores', () => {
    const { store } = make();
    store.setVolume('rain', 0.5);
    store.setMaster(0.4);
    store.setEnabled(false);
    store.saveCurrent('Mine');
    const { store: again, engine } = make();
    expect(again.mix).toEqual({ rain: 0.5 });
    expect(again.levels).toEqual({ rain: 0.5 });
    expect(again.master).toBe(0.4);
    expect(again.enabled).toBe(false);
    expect(again.saved.map((s) => s.name)).toEqual([
      'Quiet morning',
      'Busy café',
      'Rainy day',
      'Mine',
    ]);
    expect(engine.mixes.at(-1)).toEqual({});
  });
});

describe('SoundStore room list', () => {
  const room: SavedMix[] = [
    { id: 'h1', name: 'Host mix', mix: { rain: 0.5 } },
    { id: 'h2', name: 'Quiet morning', mix: { hum: 0.2 } },
  ];

  it('prefers the room list without touching my stored mixes or links, and clears back', () => {
    const { store } = make();
    const stored = localStorage.getItem('cafe:mixes');
    store.setRoomMixes(room);
    expect(store.saved.map((m) => m.id)).toEqual(['h1', 'h2']);
    store.loadSaved('h1');
    expect(store.mix).toEqual({ rain: 0.5 });
    expect(store.activeSavedId).toBe('h1');
    expect(store.renameSaved('h1', 'x')).not.toBeNull();
    store.deleteSaved('h1');
    expect(store.saved).toHaveLength(2);
    expect(localStorage.getItem('cafe:mixes')).toBe(stored);
    store.setRoomMixes(null);
    expect(store.saved.map((m) => m.name)).toEqual(['Quiet morning', 'Busy café', 'Rainy day']);
    expect(localStorage.getItem('cafe:mixes')).toBe(stored);
  });

  it('saves through the room only when it can append, and rejects duplicate names', () => {
    const { store } = make();
    store.setRoomMixes(room);
    store.setVolume('rain', 0.3);
    expect(store.saveCurrent('Study')).toBe('Only the host or a co-host can save mixes.');
    const append = vi.fn();
    store.roomAppend = append;
    expect(store.saveCurrent('quiet MORNING')).toBe('Another mix already has that name.');
    expect(store.saveCurrent('Study')).toBeNull();
    expect(append).toHaveBeenCalledWith({
      id: expect.any(String),
      name: 'Study',
      mix: { rain: 0.3 },
    });
    expect(store.ownMixes.map((m) => m.name)).not.toContain('Study');
    store.setRoomMixes(null);
    expect(store.roomAppend).toBeNull();
  });

  it('adoptMixes adds only unknown ids, renames clashing names, and never deletes', () => {
    const { store } = make();
    const before = store.ownMixes.length;
    store.adoptMixes([
      { id: 'builtin:rainy-day', name: 'Changed', mix: {} },
      { id: 'n1', name: 'Busy café', mix: { rain: 0.2 } },
      { id: 'n2', name: 'Fresh', mix: { hum: 0.2 } },
    ]);
    expect(store.ownMixes).toHaveLength(before + 2);
    expect(store.ownMixes.find((m) => m.id === 'builtin:rainy-day')!.name).toBe('Rainy day');
    expect(store.ownMixes.find((m) => m.id === 'n1')!.name).toBe('Busy café (2)');
    expect(make().store.ownMixes.map((m) => m.id)).toContain('n2');
    store.adoptMixes([]);
    expect(store.ownMixes).toHaveLength(before + 2);
  });
});
