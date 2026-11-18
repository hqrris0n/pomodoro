import { load, save } from '../storage';
import type { Mix, SavedMix, SoundChannel } from '../types';
import { scenes } from '../backgrounds/registry';
import { AudioEngine } from './engine';

export type { SavedMix };

type EngineLike = Pick<
  AudioEngine,
  'unlock' | 'setChannels' | 'setMix' | 'setMaster' | 'setMuted' | 'playChime'
>;

/** `muted` is only read, from prefs saved before mute and the Sound switch were one setting. */
type SoundPrefs = { mix: Mix; levels: Mix; master: number; enabled: boolean; muted?: boolean };

const MAX_NAME = 30;
/** Most mixes a room's list may hold (the server enforces the same limits). */
export const MAX_ROOM_MIXES = 40;
const MAX_ID = 40;
const DEFAULT_LEVEL = 0.5;

/** Seeded once into a user's saved mixes; after that they are ordinary mixes. */
export const PRESETS: SavedMix[] = [
  {
    id: 'builtin:quiet-morning',
    name: 'Quiet morning',
    mix: { hum: 0.5, pages: 0.3, dishes: 0.2 },
  },
  {
    id: 'builtin:busy-cafe',
    name: 'Busy café',
    mix: { chatter: 0.7, espresso: 0.5, dishes: 0.4, hum: 0.3 },
  },
  { id: 'builtin:rainy-day', name: 'Rainy day', mix: { rain: 0.7, fireplace: 0.4, hum: 0.2 } },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Keep finite entries with volume > 0, clamped to 1. */
function cleanMix(raw: unknown): Mix {
  const out: Mix = {};
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[id] = clamp01(v);
    }
  }
  return out;
}

function sameMix(a: Mix, b: Mix): boolean {
  const ka = Object.keys(a).filter((k) => a[k] > 0);
  const kb = Object.keys(b).filter((k) => b[k] > 0);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

let idCounter = 0;
const newId = () => `u${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export class SoundStore {
  channels = $state<SoundChannel[]>([]);
  error = $state<string | null>(null);
  mix = $state<Mix>({});
  /** Last non-zero level per channel, kept while the channel is switched off. */
  levels = $state<Mix>({});
  master = $state(0.8);
  /** The one sound setting: the mixer's Sound switch and the top-bar mute button. */
  enabled = $state(false);
  /** Muted is simply not enabled. */
  get muted(): boolean {
    return !this.enabled;
  }
  private userMixes = $state<SavedMix[]>([]);
  /** backgroundId -> mixId: the mix that starts when that background is chosen. */
  links = $state<Record<string, string>>({});

  /**
   * The host's list while I am a guest or co-host in a room, else null. It
   * replaces my own list in the mixer without touching my stored mixes or links.
   */
  roomMixes = $state.raw<SavedMix[] | null>(null);
  /** Set by the rooms store while I am a co-host: sends a new mix to the room's list. */
  roomAppend: ((mix: SavedMix) => void) | null = null;

  saved = $derived<SavedMix[]>(this.roomMixes ?? this.userMixes);
  activeSavedId = $derived<string | null>(
    this.saved.find((s) => sameMix(s.mix, this.mix))?.id ?? null,
  );

  private readonly engine: EngineLike;

  constructor(engine: EngineLike) {
    this.engine = engine;
    const prefs = load<Partial<SoundPrefs>>('sound', {});
    this.mix = cleanMix(prefs.mix);
    this.levels = { ...cleanMix(prefs.levels), ...this.mix };
    if (typeof prefs.master === 'number' && Number.isFinite(prefs.master)) {
      this.master = clamp01(prefs.master);
    }
    this.enabled = prefs.enabled === true && prefs.muted !== true;
    const stored = load<unknown>('mixes', null);
    if (Array.isArray(stored)) {
      for (const m of stored) {
        if (
          m &&
          typeof m.id === 'string' &&
          typeof m.name === 'string' &&
          m.name.length > 0 &&
          this.userMixes.every((u) => u.id !== m.id)
        ) {
          this.userMixes.push({ id: m.id, name: m.name, mix: cleanMix(m.mix) });
        }
      }
    }
    this.seedPresets(stored === null);
    const storedLinks = load<unknown>('mixLinks', {});
    if (storedLinks && typeof storedLinks === 'object' && !Array.isArray(storedLinks)) {
      for (const [bg, mixId] of Object.entries(storedLinks)) {
        if (
          typeof mixId === 'string' &&
          scenes.some((s) => s.id === bg) &&
          this.saved.some((m) => m.id === mixId)
        ) {
          this.links[bg] = mixId;
        }
      }
    }
    this.push();
  }

  async load(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}sounds/sounds.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw: unknown = await res.json();
      if (!Array.isArray(raw)) throw new Error('sounds.json is not an array');
      const channels: SoundChannel[] = [];
      for (const c of raw) {
        if (
          c &&
          typeof c.id === 'string' &&
          c.id &&
          typeof c.name === 'string' &&
          typeof c.file === 'string' &&
          c.file &&
          !channels.some((x) => x.id === c.id)
        ) {
          channels.push({ id: c.id, name: c.name, file: c.file });
        }
      }
      this.channels = channels;
      this.error = null;
      this.engine.setChannels(
        channels.map((c) => ({ id: c.id, url: `${import.meta.env.BASE_URL}sounds/${c.file}` })),
      );
      this.push();
    } catch {
      this.error = "Couldn't load the sounds. Reload the page to try again.";
    }
  }

  /** Set one channel's level; raising it turns sound on. */
  setVolume(channelId: string, volume: number): void {
    this.applyVolume(channelId, volume);
    if (this.mix[channelId] > 0) this.enabled = true;
    this.commit();
  }

  private applyVolume(channelId: string, volume: number): void {
    const v = Number.isFinite(volume) ? clamp01(volume) : 0;
    const next = { ...this.mix };
    if (v > 0) {
      next[channelId] = v;
      this.levels = { ...this.levels, [channelId]: v };
    } else {
      delete next[channelId];
    }
    this.mix = next;
  }

  /** Switch one channel on (at its remembered level, else 50%) or off. Never touches `enabled`. */
  setChannelOn(channelId: string, on: boolean): void {
    this.applyVolume(channelId, on ? (this.levels[channelId] ?? DEFAULT_LEVEL) : 0);
    this.commit();
  }

  /** Set the overall volume; moving it turns sound on. */
  setMaster(v: number): void {
    this.master = Number.isFinite(v) ? clamp01(v) : 0;
    this.enabled = true;
    this.commit();
  }

  toggleMuted(): void {
    this.setEnabled(!this.enabled);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.commit();
  }

  applyMix(mix: Mix): void {
    this.setMixLevels(mix);
    this.commit();
  }

  /** My own list in the form a room accepts: valid entries only, at most MAX_ROOM_MIXES. */
  get ownMixes(): SavedMix[] {
    return $state
      .snapshot(this.userMixes)
      .filter((m) => m.id.length <= MAX_ID && m.name.length <= MAX_NAME)
      .slice(0, MAX_ROOM_MIXES);
  }

  /** Show `list` instead of my own mixes (null: back to my own). Nothing is stored. */
  setRoomMixes(list: SavedMix[] | null): void {
    this.roomMixes = list === null ? null : list.map((m) => ({ ...m, mix: { ...m.mix } }));
    if (list === null) this.roomAppend = null;
  }

  /**
   * Add mixes from a room I host to my own list: only ids I do not have. A name
   * that is already taken gets a " (2)" style suffix. Never deletes or edits.
   */
  adoptMixes(list: SavedMix[]): void {
    let added = false;
    for (const m of list) {
      if (this.userMixes.some((u) => u.id === m.id)) continue;
      let name = m.name;
      for (
        let i = 2;
        this.userMixes.some((u) => u.name.toLowerCase() === name.toLowerCase());
        i++
      ) {
        const suffix = ` (${i})`;
        name = m.name.slice(0, MAX_NAME - suffix.length) + suffix;
      }
      this.userMixes.push({ id: m.id, name, mix: cleanMix(m.mix) });
      added = true;
    }
    if (added) this.persistMixes();
  }

  saveCurrent(name: string): string | null {
    const n = name.trim();
    const err = this.validateName(n);
    if (err) return err;
    const snapshot = cleanMix($state.snapshot(this.mix));
    if (this.roomMixes !== null) {
      // In someone's room only a co-host may save, and the mix goes to the host's list.
      if (!this.roomAppend) return 'Only the host or a co-host can save mixes.';
      if (this.roomMixes.some((m) => m.name.toLowerCase() === n.toLowerCase())) {
        return 'Another mix already has that name.';
      }
      if (this.roomMixes.length >= MAX_ROOM_MIXES) return "The host's list is full.";
      this.roomAppend({ id: newId(), name: n, mix: snapshot });
      return null;
    }
    const existing = this.userMixes.find((m) => m.name.toLowerCase() === n.toLowerCase());
    if (existing) {
      existing.name = n;
      existing.mix = snapshot;
    } else {
      this.userMixes.push({ id: newId(), name: n, mix: snapshot });
    }
    this.persistMixes();
    return null;
  }

  loadSaved(id: string): void {
    const m = this.saved.find((s) => s.id === id);
    if (!m) return;
    this.setMixLevels($state.snapshot(m.mix));
    this.commit();
  }

  /** Background ids linked to this mix. */
  linksFor(mixId: string): string[] {
    return Object.keys(this.links).filter((bg) => this.links[bg] === mixId);
  }

  /** on: make mixId the mix for backgroundId (replacing any other). off: unlink if it points at mixId. */
  setLink(backgroundId: string, mixId: string, on: boolean): void {
    if (this.roomMixes !== null) return;
    if (on) {
      if (!scenes.some((s) => s.id === backgroundId)) return;
      if (!this.saved.some((m) => m.id === mixId)) return;
      this.links[backgroundId] = mixId;
    } else if (this.links[backgroundId] === mixId) {
      delete this.links[backgroundId];
    } else return;
    this.persistLinks();
  }

  /** Add the presets once: on first load, or once for storage that predates them. */
  private seedPresets(fresh: boolean): void {
    if (!fresh && load<unknown>('presetsSeeded', false) === true) return;
    const add = PRESETS.filter((p) =>
      this.userMixes.every((u) => u.id !== p.id && u.name.toLowerCase() !== p.name.toLowerCase()),
    ).map((p) => ({ ...p, mix: { ...p.mix } }));
    this.userMixes.unshift(...add);
    this.persistMixes();
    save('presetsSeeded', true);
  }

  /** Returns an error message, or null on success. No-op (null) on unknown ids. */
  renameSaved(id: string, name: string): string | null {
    if (this.roomMixes !== null) return "Only the host can change the host's mixes.";
    const target = this.userMixes.find((m) => m.id === id);
    if (!target) return null;
    const n = name.trim();
    const err = this.validateName(n);
    if (err) return err;
    const clash = this.userMixes.some(
      (m) => m.id !== id && m.name.toLowerCase() === n.toLowerCase(),
    );
    if (clash) return 'Another mix already has that name.';
    target.name = n;
    this.persistMixes();
    return null;
  }

  deleteSaved(id: string): void {
    if (this.roomMixes !== null) return;
    const i = this.userMixes.findIndex((m) => m.id === id);
    if (i < 0) return;
    this.userMixes.splice(i, 1);
    this.persistMixes();
    let changed = false;
    for (const bg of Object.keys(this.links)) {
      if (this.links[bg] === id) {
        delete this.links[bg];
        changed = true;
      }
    }
    if (changed) this.persistLinks();
  }

  unlock(): Promise<void> {
    const p = this.engine.unlock();
    this.push();
    return p;
  }

  /** Play a short effect from sounds/<name>.mp3; follows master volume and mute, not `enabled`. */
  effect(name: string, gain = 1): Promise<void> {
    return this.engine.playChime(`${import.meta.env.BASE_URL}sounds/${name}.mp3`, gain);
  }

  chime(): Promise<void> {
    return this.effect('chime');
  }

  private setMixLevels(mix: Mix): void {
    this.mix = cleanMix(mix);
    this.levels = { ...this.levels, ...this.mix };
  }

  private validateName(n: string): string | null {
    if (!n) return 'Give the mix a name.';
    if (n.length > MAX_NAME) return `Keep the name to ${MAX_NAME} characters or fewer.`;
    return null;
  }

  private persistMixes(): void {
    save('mixes', $state.snapshot(this.userMixes));
  }

  private persistLinks(): void {
    save('mixLinks', $state.snapshot(this.links));
  }

  private commit(): void {
    save('sound', {
      mix: $state.snapshot(this.mix),
      levels: $state.snapshot(this.levels),
      master: this.master,
      enabled: this.enabled,
    } satisfies SoundPrefs);
    this.push();
  }

  private push(): void {
    this.engine.setMaster(this.master);
    this.engine.setMuted(this.muted);
    this.engine.setMix(this.enabled ? $state.snapshot(this.mix) : {});
  }
}

export const sound = new SoundStore(new AudioEngine());
