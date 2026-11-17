import type { Mix } from '../types';

/** Slider position (0..1) to linear gain; squared so the slider feels even. */
export function volumeToGain(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  const v = Math.min(1, Math.max(0, volume));
  return v * v;
}

export type AudioEngineDeps = {
  createContext?: () => AudioContext;
  fetchBuffer?: (url: string) => Promise<ArrayBuffer>;
};

/** Gain ramp time constant in seconds. */
const TIME_CONSTANT = 0.08;
/** Wait this long after ramping to 0 (about 6 time constants) before releasing a channel. */
const RELEASE_MS = 500;

type Channel = {
  url: string;
  buffer: AudioBuffer | null;
  loading: Promise<void> | null;
  /** Load failed; do not retry until the channel is turned off and on again. */
  failed: boolean;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

function defaultCreateContext(): AudioContext {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('Web Audio is not supported');
  try {
    // A low sample rate shrinks decoded buffers (matters on phones).
    return new Ctor({ sampleRate: 32000 });
  } catch {
    return new Ctor();
  }
}

async function defaultFetchBuffer(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.arrayBuffer();
}

export class AudioEngine {
  onError: ((channelId: string, error: unknown) => void) | null = null;

  private readonly createContext: () => AudioContext;
  private readonly fetchBuffer: (url: string) => Promise<ArrayBuffer>;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private chimeGain: GainNode | null = null;
  private chimeBuffers = new Map<string, AudioBuffer>();
  private channels = new Map<string, Channel>();
  private mix: Mix = {};
  private master = 1;
  private muted = false;
  private disposed = false;

  constructor(deps: AudioEngineDeps = {}) {
    this.createContext = deps.createContext ?? defaultCreateContext;
    this.fetchBuffer = deps.fetchBuffer ?? defaultFetchBuffer;
  }

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') void this.resume();
  };

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch (e) {
        this.onError?.('context', e);
        return;
      }
      const ctx = this.ctx;
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.masterTarget();
      this.masterGain.connect(ctx.destination);
      this.chimeGain = ctx.createGain();
      this.chimeGain.gain.value = this.masterTarget();
      this.chimeGain.connect(ctx.destination);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.onVisibility);
      }
    }
    await this.resume();
    this.syncAll();
  }

  setChannels(channels: { id: string; url: string }[]): void {
    const ids = new Set(channels.map((c) => c.id));
    for (const [id, ch] of this.channels) {
      if (!ids.has(id)) {
        this.stopChannel(ch);
        this.channels.delete(id);
      }
    }
    for (const { id, url } of channels) {
      const existing = this.channels.get(id);
      if (existing) {
        if (existing.url !== url) {
          this.stopChannel(existing);
          existing.url = url;
        }
      } else {
        this.channels.set(id, {
          url,
          buffer: null,
          loading: null,
          failed: false,
          source: null,
          gain: null,
          releaseTimer: null,
        });
      }
    }
    this.syncAll();
  }

  setMix(mix: Mix): void {
    this.mix = { ...mix };
    this.syncAll();
  }

  setMaster(volume: number): void {
    this.master = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.rampMaster();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.rampMaster();
  }

  async playChime(url: string, gain = 1): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || !this.chimeGain || this.disposed) return;
    try {
      let buffer = this.chimeBuffers.get(url);
      if (!buffer) {
        buffer = await ctx.decodeAudioData(await this.fetchBuffer(url));
        this.chimeBuffers.set(url, buffer);
      }
      if (this.disposed) return;
      await this.resume();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (gain === 1) {
        src.connect(this.chimeGain);
      } else {
        const g = ctx.createGain();
        g.gain.value = gain;
        src.connect(g);
        g.connect(this.chimeGain);
      }
      src.start();
    } catch (e) {
      this.onError?.('chime', e);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    for (const ch of this.channels.values()) this.stopChannel(ch);
    this.channels.clear();
    this.chimeBuffers.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.masterGain = null;
    this.chimeGain = null;
    if (ctx && ctx.state !== 'closed') void Promise.resolve(ctx.close()).catch(() => {});
  }

  // --- internals ---

  private async resume(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    // iOS can report 'interrupted' (not in lib.dom's union) after calls or backgrounding.
    if ((ctx.state as string) !== 'running') {
      try {
        await ctx.resume();
      } catch (e) {
        this.onError?.('context', e);
      }
    }
  }

  private masterTarget(): number {
    return this.muted ? 0 : volumeToGain(this.master);
  }

  private rampMaster(): void {
    this.ramp(this.masterGain, this.masterTarget());
    this.ramp(this.chimeGain, this.masterTarget());
  }

  private ramp(node: GainNode | null, target: number): void {
    if (!node || !this.ctx) return;
    node.gain.setTargetAtTime(target, this.ctx.currentTime, TIME_CONSTANT);
  }

  private syncAll(): void {
    if (!this.ctx) return;
    for (const id of this.channels.keys()) this.sync(id);
  }

  private sync(id: string): void {
    const ctx = this.ctx;
    const ch = this.channels.get(id);
    if (!ctx || !this.masterGain || !ch) return;
    const volume = this.mix[id] ?? 0;

    if (!(volume > 0)) {
      ch.failed = false;
      if (ch.source && !ch.releaseTimer) {
        this.ramp(ch.gain, 0);
        ch.releaseTimer = setTimeout(() => this.stopChannel(ch), RELEASE_MS);
      } else if (!ch.source && !ch.loading) {
        ch.buffer = null;
      }
      return;
    }

    if (ch.releaseTimer) {
      clearTimeout(ch.releaseTimer);
      ch.releaseTimer = null;
    }
    if (ch.failed) return;
    if (!ch.buffer) {
      if (!ch.loading) this.load(id, ch, ctx);
      return;
    }
    if (!ch.source) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.masterGain);
      const src = ctx.createBufferSource();
      src.buffer = ch.buffer;
      src.loop = true;
      src.connect(gain);
      src.start();
      ch.source = src;
      ch.gain = gain;
    }
    this.ramp(ch.gain, volumeToGain(volume));
  }

  private load(id: string, ch: Channel, ctx: AudioContext): void {
    ch.loading = (async () => {
      try {
        const data = await this.fetchBuffer(ch.url);
        const buffer = await ctx.decodeAudioData(data);
        if (this.disposed || this.ctx !== ctx) return;
        // Only keep it if the channel is still wanted.
        if ((this.mix[id] ?? 0) > 0) ch.buffer = buffer;
      } catch (e) {
        ch.failed = true;
        this.onError?.(id, e);
      } finally {
        ch.loading = null;
      }
      this.sync(id);
    })();
  }

  private stopChannel(ch: Channel): void {
    if (ch.releaseTimer) clearTimeout(ch.releaseTimer);
    ch.releaseTimer = null;
    if (ch.source) {
      try {
        ch.source.stop();
      } catch {
        // already stopped
      }
      ch.source.disconnect();
    }
    ch.gain?.disconnect();
    ch.source = null;
    ch.gain = null;
    ch.buffer = null;
  }
}
