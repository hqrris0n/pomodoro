import { load, save } from '../storage';
import type { Mix, SoundChannel } from '../types';
import { AudioEngine } from './engine';

export type SavedMix = { id: string; name: string; mix: Mix; builtIn: boolean };

type EngineLike = Pick<
  AudioEngine,
  'unlock' | 'setChannels' | 'setMix' | 'setMaster' | 'setMuted' | 'playChime'
>;

type SoundPrefs = { mix: Mix; master: number; muted: boolean; enabled: boolean };
type StoredMix = { id: string; name: string; mix: Mix };

const MAX_NAME = 30;

const builtIn = (id: string, name: string, mix: Mix): SavedMix => ({
  id: `builtin:${id}`,
  name,
  mix,
  builtIn: true,
});

const BUILT_INS: SavedMix[] = [
  builtIn('quiet-morning', 'Quiet morning', { hum: 0.5, pages: 0.3, dishes: 0.2 }),
  builtIn('busy-cafe', 'Busy café', { chatter: 0.7, espresso: 0.5, dishes: 0.4, hum: 0.3 }),
  builtIn('rainy-day', 'Rainy day', { rain: 0.7, fireplace: 0.4, hum: 0.2 }),
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
  master = $state(0.8);
  muted = $state(false);
  enabled = $state(false);
  private userMixes = $state<StoredMix[]>([]);

  saved = $derived<SavedMix[]>([
    ...BUILT_INS,
    ...this.userMixes.map((m) => ({ ...m, builtIn: false })),
  ]);
  activeSavedId = $derived<string | null>(
    this.saved.find((s) => sameMix(s.mix, this.mix))?.id ?? null,
  );

  private readonly engine: EngineLike;

  constructor(engine: EngineLike) {
    this.engine = engine;
    const prefs = load<Partial<SoundPrefs>>('sound', {});
    this.mix = cleanMix(prefs.mix);
    if (typeof prefs.master === 'number' && Number.isFinite(prefs.master)) {
      this.master = clamp01(prefs.master);
    }
    this.muted = prefs.muted === true;
    this.enabled = prefs.enabled === true;
    const stored = load<unknown>('mixes', []);
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

  setVolume(channelId: string, volume: number): void {
    const v = Number.isFinite(volume) ? clamp01(volume) : 0;
    const next = { ...this.mix };
    if (v > 0) {
      next[channelId] = v;
      this.enabled = true;
    } else {
      delete next[channelId];
    }
    this.mix = next;
    this.commit();
  }

  setMaster(v: number): void {
    this.master = Number.isFinite(v) ? clamp01(v) : 0;
    this.commit();
  }

  toggleMuted(): void {
    this.muted = !this.muted;
    this.commit();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.commit();
  }

  applyMix(mix: Mix): void {
    this.mix = cleanMix(mix);
    if (Object.keys(this.mix).length > 0) this.enabled = true;
    this.commit();
  }

  saveCurrent(name: string): string | null {
    const n = name.trim();
    const err = this.validateName(n);
    if (err) return err;
    const snapshot = cleanMix($state.snapshot(this.mix));
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
    this.mix = cleanMix($state.snapshot(m.mix));
    this.enabled = true;
    this.commit();
  }

  /** Returns an error message, or null on success. No-op (null) on built-ins and unknown ids. */
  renameSaved(id: string, name: string): string | null {
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
    const i = this.userMixes.findIndex((m) => m.id === id);
    if (i < 0) return;
    this.userMixes.splice(i, 1);
    this.persistMixes();
  }

  unlock(): Promise<void> {
    const p = this.engine.unlock();
    this.push();
    return p;
  }

  chime(): Promise<void> {
    return this.engine.playChime(`${import.meta.env.BASE_URL}sounds/chime.mp3`);
  }

  private validateName(n: string): string | null {
    if (!n) return 'Give the mix a name.';
    if (n.length > MAX_NAME) return `Keep the name to ${MAX_NAME} characters or fewer.`;
    if (BUILT_INS.some((b) => b.name.toLowerCase() === n.toLowerCase())) {
      return 'That name is taken by a built-in mix.';
    }
    return null;
  }

  private persistMixes(): void {
    save('mixes', $state.snapshot(this.userMixes));
  }

  private commit(): void {
    save('sound', {
      mix: $state.snapshot(this.mix),
      master: this.master,
      muted: this.muted,
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
