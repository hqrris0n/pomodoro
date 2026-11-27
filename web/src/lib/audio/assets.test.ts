import { describe, expect, it } from 'vitest';
import channels from '../../../public/sounds/sounds.json';

// The real files in public/sounds. Only the names matter here, so load URLs, not audio.
const files = import.meta.glob<string>('/public/sounds/*', {
  query: '?url',
  import: 'default',
  eager: true,
});
const hasFile = (name: string) => `/public/sounds/${name}` in files;

// Effects played by name through sound.effect(): the timer chime, the Clear completed
// pop and the sticky-note page turn.
const EFFECTS = ['chime', 'pop', 'page'];

describe('sound files', () => {
  it('has a file for every mixer channel in sounds.json', () => {
    expect(channels.length).toBeGreaterThan(0);
    const missing = channels.filter((c) => !hasFile(c.file)).map((c) => c.file);
    expect(missing).toEqual([]);
  });

  it('has a file for every effect', () => {
    expect(EFFECTS.filter((e) => !hasFile(`${e}.mp3`))).toEqual([]);
  });

  it('gives every channel a unique id and a name', () => {
    const ids = channels.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(channels.every((c) => c.name.trim().length > 0)).toBe(true);
  });
});
