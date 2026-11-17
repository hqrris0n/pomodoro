import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine, volumeToGain } from './engine';

class FakeGain {
  gain = {
    value: 1,
    calls: [] as number[],
    setTargetAtTime(target: number) {
      this.calls.push(target);
    },
  };
  connected: unknown = null;
  connect(to: unknown) {
    this.connected = to;
  }
  disconnect() {}
}

class FakeSource {
  buffer: unknown = null;
  loop = false;
  started = 0;
  stopped = 0;
  connected: unknown = null;
  connect(to: unknown) {
    this.connected = to;
  }
  disconnect() {}
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
}

class FakeContext {
  state = 'suspended';
  currentTime = 0;
  destination = {};
  gains: FakeGain[] = [];
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {});
  createGain() {
    const g = new FakeGain();
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer) {
    return { decoded: data.byteLength };
  }
}

function setup(fail: string[] = []) {
  const ctx = new FakeContext();
  const fetchBuffer = vi.fn(async (url: string) => {
    if (fail.some((f) => url.includes(f))) throw new Error('nope');
    return new ArrayBuffer(8);
  });
  const engine = new AudioEngine({
    createContext: () => ctx as unknown as AudioContext,
    fetchBuffer,
  });
  engine.setChannels([
    { id: 'rain', url: '/rain.mp3' },
    { id: 'hum', url: '/hum.mp3' },
  ]);
  return { ctx, fetchBuffer, engine };
}

/** Gain nodes in creation order: 0 master, 1 chime, then one per started channel. */
const master = (ctx: FakeContext) => ctx.gains[0];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('volumeToGain', () => {
  it('squares and clamps', () => {
    expect(volumeToGain(0.5)).toBe(0.25);
    expect(volumeToGain(2)).toBe(1);
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(NaN)).toBe(0);
  });
});

describe('AudioEngine', () => {
  it('does nothing before unlock, then loads and plays once', async () => {
    const { ctx, fetchBuffer, engine } = setup();
    engine.setMix({ rain: 0.5 });
    expect(fetchBuffer).not.toHaveBeenCalled();
    expect(ctx.sources).toHaveLength(0);

    await engine.unlock();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
    expect(fetchBuffer).toHaveBeenCalledWith('/rain.mp3');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].loop).toBe(true);
    expect(ctx.sources[0].started).toBe(1);
    expect(ctx.gains[2].gain.calls.at(-1)).toBe(0.25);
  });

  it('stops the source after ramping to zero and reloads when turned back on', async () => {
    const { ctx, fetchBuffer, engine } = setup();
    await engine.unlock();
    engine.setMix({ rain: 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    engine.setMix({ rain: 0 });
    expect(ctx.gains[2].gain.calls.at(-1)).toBe(0);
    expect(ctx.sources[0].stopped).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.sources[0].stopped).toBe(1);

    engine.setMix({ rain: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer).toHaveBeenCalledTimes(2);
    expect(ctx.sources).toHaveLength(2);
  });

  it('deduplicates a fetch that is still in flight', async () => {
    const { fetchBuffer, engine } = setup();
    await engine.unlock();
    engine.setMix({ rain: 0.5 });
    engine.setMix({ rain: 0.6 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown channel ids', async () => {
    const { fetchBuffer, engine } = setup();
    await engine.unlock();
    engine.setMix({ nope: 1 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer).not.toHaveBeenCalled();
  });

  it('mutes via the master gain without stopping sources', async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    engine.setMaster(0.5);
    engine.setMix({ rain: 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    engine.setMuted(true);
    expect(master(ctx).gain.calls.at(-1)).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.sources[0].stopped).toBe(0);
    engine.setMuted(false);
    expect(master(ctx).gain.calls.at(-1)).toBe(0.25);
  });

  it('reports a failed channel and keeps the others playing', async () => {
    const { ctx, fetchBuffer, engine } = setup(['rain']);
    const onError = vi.fn();
    engine.onError = onError;
    await engine.unlock();
    engine.setMix({ rain: 0.5, hum: 0.5 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe('rain');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(1);

    // No retry while still on; retried after being turned off and on.
    engine.setMix({ rain: 0.5, hum: 0.4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer.mock.calls.filter(([u]) => u === '/rain.mp3')).toHaveLength(1);
    engine.setMix({ rain: 0, hum: 0.4 });
    engine.setMix({ rain: 0.5, hum: 0.4 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchBuffer.mock.calls.filter(([u]) => u === '/rain.mp3')).toHaveLength(2);
  });

  it('plays the chime only after unlock, silenced by mute', async () => {
    const { ctx, engine } = setup();
    await engine.playChime('/chime.mp3');
    expect(ctx.sources).toHaveLength(0);
    await engine.unlock();
    engine.setMuted(true);
    await engine.playChime('/chime.mp3');
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].started).toBe(1);
    expect(ctx.sources[0].connected).toBe(ctx.gains[1]);
    expect(ctx.gains[1].gain.calls.at(-1)).toBe(0);
  });

  it('resumes a suspended context when the page becomes visible', async () => {
    const { ctx, engine } = setup();
    await engine.unlock();
    ctx.state = 'interrupted';
    ctx.resume.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    engine.dispose();
    expect(ctx.close).toHaveBeenCalled();
  });
});
