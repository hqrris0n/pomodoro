import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backgrounds } from '../backgrounds/backgrounds.svelte';
import type { Mix } from '../types';
import { installMixLinks } from './links.svelte';
import { SoundStore, sound } from './mixes.svelte';

function make() {
  const engine = {
    unlock: vi.fn(async () => {}),
    setChannels: vi.fn(),
    setMix: vi.fn<(m: Mix) => void>(),
    setMaster: vi.fn(),
    setMuted: vi.fn(),
    playChime: vi.fn(async () => {}),
  };
  return new SoundStore(engine);
}

const RAINY = 'builtin:rainy-day';
const BUSY = 'builtin:busy-cafe';

beforeEach(() => localStorage.clear());

describe('mix links store', () => {
  it('moves a background between mixes and lets one mix hold several', () => {
    const s = make();
    s.setLink('night-lights', RAINY, true);
    s.setLink('rainy-window', RAINY, true);
    expect(s.linksFor(RAINY).sort()).toEqual(['night-lights', 'rainy-window']);
    s.setLink('night-lights', BUSY, true);
    expect(s.linksFor(RAINY)).toEqual(['rainy-window']);
    expect(s.linksFor(BUSY)).toEqual(['night-lights']);
    s.setLink('night-lights', RAINY, false); // not its mix: ignored
    expect(s.linksFor(BUSY)).toEqual(['night-lights']);
    s.setLink('night-lights', BUSY, false);
    expect(s.linksFor(BUSY)).toEqual([]);
  });

  it('persists, and deleting a mix removes its links', () => {
    const s = make();
    s.setEnabled(true);
    s.setVolume('rain', 0.5);
    s.saveCurrent('Mine');
    const id = s.saved.find((m) => m.name === 'Mine')!.id;
    s.setLink('night-lights', id, true);
    s.setLink('rainy-window', RAINY, true);
    expect(make().links).toEqual({ 'night-lights': id, 'rainy-window': RAINY });
    s.deleteSaved(id);
    expect(s.links).toEqual({ 'rainy-window': RAINY });
    expect(make().links).toEqual({ 'rainy-window': RAINY });
  });

  it('drops invalid stored links', () => {
    localStorage.setItem(
      'cafe:mixLinks',
      JSON.stringify({
        'night-lights': RAINY,
        'rainy-window': 5,
        nowhere: RAINY,
        'rooftop-dusk': 'gone',
      }),
    );
    expect(make().links).toEqual({ 'night-lights': RAINY });
    localStorage.setItem('cafe:mixLinks', JSON.stringify([1]));
    expect(make().links).toEqual({});
  });
});

describe('installMixLinks', () => {
  beforeEach(() => {
    backgrounds.select('rainy-window');
    sound.links = {};
    sound.mix = {};
    sound.setEnabled(false);
  });

  it('loads the linked mix on choose and next, not on select, leaving Sound alone', () => {
    const off = installMixLinks();
    sound.setLink('night-lights', RAINY, true);
    sound.setLink('morning-counter', BUSY, true);

    backgrounds.select('night-lights'); // room sync path
    expect(sound.mix).toEqual({});
    backgrounds.select('rainy-window');

    backgrounds.choose('night-lights');
    expect(sound.activeSavedId).toBe(RAINY);
    expect(sound.enabled).toBe(false);

    sound.setEnabled(true);
    sound.mix = {};
    backgrounds.choose('night-lights'); // same background: no fire
    expect(sound.mix).toEqual({});
    expect(sound.enabled).toBe(true);

    backgrounds.select('rainy-window');
    backgrounds.next(); // rotation -> morning-counter
    expect(sound.activeSavedId).toBe(BUSY);

    off();
    backgrounds.choose('night-lights');
    expect(sound.activeSavedId).toBe(BUSY);
  });
});
