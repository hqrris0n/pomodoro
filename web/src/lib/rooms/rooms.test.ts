import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundStore } from '../audio/mixes.svelte';
import { BackgroundStore } from '../backgrounds/backgrounds.svelte';
import { DrinkStore } from '../drinks/drinks.svelte';
import { Identity } from '../shell/identity.svelte';
import { load } from '../storage';
import { TimerEngine } from '../timer/engine.svelte';
import type { Drink, Settings, TimerState } from '../types';
import { ApiError, type Member, type Room, type RoomsApi } from './api';
import { RoomsStore } from './rooms.svelte';

class FakeSource {
  static all: FakeSource[] = [];
  closed = false;
  #l = new Map<string, ((e: Event) => void)[]>();
  constructor(readonly url: string) {
    FakeSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: Event) => void) {
    this.#l.set(type, [...(this.#l.get(type) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    const e = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const fn of this.#l.get(type) ?? []) fn(e);
  }
}

const drink = (id: string) => ({ id, name: id, image: `${id}.svg` }) as unknown as Drink;
const TIMER: TimerState = {
  focusMs: 1_500_000,
  breakMs: 300_000,
  rounds: 1,
  elapsedMs: 0,
  anchorAt: Date.now(),
};
const SETTINGS: Settings = {
  drinkId: 'mocha',
  backgroundId: 'night-lights',
  backgroundRotateMin: 10,
  mix: { rain: 0.5 },
};
const member = (id: string, role: Member['role'], joinedAt: number): Member => ({
  id,
  name: `Name ${id}`,
  role,
  joinedAt,
});
const mkRoom = (over: Partial<Room> = {}): Room => ({
  id: 'r1',
  settings: SETTINGS,
  timer: TIMER,
  members: [member('me', 'host', 1)],
  ...over,
});

function setup() {
  const api = {
    createRoom: vi.fn(async () => mkRoom()),
    joinRoom: vi.fn(async () =>
      mkRoom({ id: 'other', members: [member('o', 'host', 1), member('me', 'guest', 2)] }),
    ),
    leaveRoom: vi.fn(async () => ({})),
    patchRoom: vi.fn(async () => mkRoom()),
    setRole: vi.fn(async () => mkRoom()),
    rename: vi.fn(async () => ({})),
  };
  const identity = new Identity();
  const timer = new TimerEngine();
  const drinks = new DrinkStore();
  drinks.list = [drink('latte'), drink('mocha'), drink('tea')];
  drinks.select('latte');
  const backgrounds = new BackgroundStore();
  backgrounds.select('rainy-window');
  backgrounds.setRotate(5);
  const sound = new SoundStore({
    unlock: async () => {},
    setChannels: () => {},
    setMix: () => {},
    setMaster: () => {},
    setMuted: () => {},
    playChime: async () => {},
  });
  sound.applyMix({ hum: 0.3 });
  const sources: FakeSource[] = [];
  const rooms = new RoomsStore({
    identity,
    timer,
    drinks,
    backgrounds,
    sound,
    api: api as unknown as RoomsApi,
    createEventSource: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s as unknown as EventSource;
    },
  });
  const stop = rooms.start();
  const es = () => sources[sources.length - 1];
  const settle = () => vi.advanceTimersByTimeAsync(0);
  const connect = async (room: Room | null = null) => {
    es().emit('open');
    es().emit('room', { now: Date.now(), you: 'me', room });
    await settle();
  };
  const startTimer = async () => {
    timer.start({ focusMin: 25, breakMin: 5, rounds: 1 });
    await settle();
  };
  /** Online, timer started, and the room has been created: I am the owner of r1. */
  const asHost = async () => {
    await connect();
    await startTimer();
    api.createRoom.mockClear();
    es().emit('room', { now: Date.now(), you: 'me', room: mkRoom() });
    flushSync();
  };
  return {
    api,
    identity,
    timer,
    drinks,
    backgrounds,
    sound,
    rooms,
    stop,
    es,
    settle,
    connect,
    startTimer,
    asHost,
  };
}
type H = ReturnType<typeof setup>;

let h: H;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  FakeSource.all = [];
  h = setup();
});
afterEach(() => {
  h.stop();
  h.timer.stop();
  vi.useRealTimers();
});

describe('publishing my timer', () => {
  it('creates a room once when a timer starts while visible and online', async () => {
    await h.connect();
    await h.startTimer();
    expect(h.api.createRoom).toHaveBeenCalledOnce();
    const [token, body] = h.api.createRoom.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(token).toBe(h.identity.token);
    expect(body).toEqual({
      name: h.identity.name,
      settings: {
        drinkId: 'latte',
        backgroundId: 'rainy-window',
        backgroundRotateMin: 5,
        mix: { hum: 0.3 },
      },
      timer: h.timer.state,
    });
    expect(h.rooms.role).toBe('host');
  });

  it('sends nothing while hidden, and creates when turned on again', async () => {
    h.identity.setVisible(false);
    flushSync();
    await h.connect();
    await h.startTimer();
    expect(h.api.createRoom).not.toHaveBeenCalled();
    h.identity.setVisible(true);
    flushSync();
    await h.settle();
    expect(h.api.createRoom).toHaveBeenCalledOnce();
  });

  it('patches the timer once when the owner pauses', async () => {
    await h.asHost();
    h.timer.pause();
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    expect(h.api.patchRoom).toHaveBeenCalledWith(h.identity.token, 'r1', { timer: h.timer.state });
  });

  it('patches settings after the debounce, and coalesces rapid mix changes', async () => {
    await h.asHost();
    h.drinks.select('tea');
    flushSync();
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    expect((h.api.patchRoom.mock.calls[0] as unknown[])[2]).toMatchObject({
      settings: { drinkId: 'tea' },
    });

    h.api.patchRoom.mockClear();
    for (const v of [0.2, 0.4, 0.6]) {
      h.sound.setVolume('rain', v);
      flushSync();
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    expect((h.api.patchRoom.mock.calls[0] as unknown[])[2]).toMatchObject({
      settings: { mix: { rain: 0.6 } },
    });
  });

  it('leaves the room when the owner stops the timer', async () => {
    await h.asHost();
    h.timer.stop();
    expect(h.api.leaveRoom).toHaveBeenCalledWith(h.identity.token, 'r1');
    expect(h.rooms.room).toBeNull();
  });

  it('re-creates the room when the server forgot it', async () => {
    await h.asHost();
    h.es().emit('room', { now: Date.now(), you: 'me', room: null });
    await h.settle();
    expect(h.api.createRoom).toHaveBeenCalledOnce();
  });

  it('re-creates with the time already elapsed, since the server re-anchors to its now', async () => {
    await h.asHost();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    h.es().emit('room', { now: Date.now(), you: 'me', room: null });
    await h.settle();
    const body = (h.api.createRoom.mock.calls[0] as unknown[])[1] as { timer: TimerState };
    expect(Math.abs(body.timer.elapsedMs - 5 * 60_000)).toBeLessThan(1000);
    expect(body.timer.anchorAt).not.toBeNull();
  });
});

describe('two tabs of one browser (one token, one member)', () => {
  /** What the browser does in every other tab when this one writes localStorage. */
  const otherTabsSee = (key: string) =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `cafe:${key}`,
        newValue: localStorage.getItem(`cafe:${key}`),
      }),
    );

  it('keeps the timer stopped in both tabs after the owner leaves', async () => {
    const a = h;
    const b = setup();
    try {
      await a.asHost();
      // Tab B takes its turn on the token's single stream and mirrors r1.
      b.es().emit('open');
      b.es().emit('room', { now: Date.now(), you: 'me', room: mkRoom({ timer: a.timer.state! }) });
      await b.settle();
      expect(b.timer.state).not.toBeNull();
      await vi.advanceTimersByTimeAsync(5 * 60_000);

      // Leave (confirmed) in tab A.
      a.timer.stop();
      otherTabsSee('timer');
      // The server now has this token in no room; B holds the stream and hears it.
      b.es().emit('room', { now: Date.now(), you: 'me', room: null });
      await b.settle();

      // Tab A gets the stream back later and receives whatever room the token is in.
      const created = b.api.createRoom.mock.calls[0] as unknown[] | undefined;
      const sent = (created?.[1] as { timer: TimerState } | undefined)?.timer;
      const serverRoom = sent
        ? mkRoom({ id: 'r2', timer: { ...sent, anchorAt: Date.now() } })
        : null;
      a.es().emit('room', { now: Date.now(), you: 'me', room: serverRoom });
      await a.settle();

      expect(a.timer.state).toBeNull();
      expect(b.timer.state).toBeNull();
      expect(b.api.createRoom).not.toHaveBeenCalled();
    } finally {
      b.stop();
      b.timer.stop();
    }
  });
});

describe('applying remote state', () => {
  it('mirrors a co-host change without sending any request', async () => {
    await h.asHost();
    const paused: TimerState = { ...TIMER, elapsedMs: 5000, anchorAt: null };
    h.es().emit('room', {
      now: Date.now(),
      you: 'me',
      room: mkRoom({
        timer: paused,
        settings: { ...SETTINGS, drinkId: 'tea', backgroundRotateMin: 5, mix: { hum: 0.3 } },
        members: [member('o', 'host', 0), member('me', 'cohost', 1)],
      }),
    });
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.drinks.selectedId).toBe('tea');
    expect(h.timer.state).toEqual(paused);
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    expect(h.api.createRoom).not.toHaveBeenCalled();
  });

  it('tells the engine about the server clock offset', async () => {
    const spy = vi.spyOn(h.timer, 'setClockOffset');
    h.es().emit('rooms', { now: Date.now() + 5000, rooms: [] });
    expect(spy).toHaveBeenCalledWith(5000);
  });

  it('keeps my own room out of the list', async () => {
    await h.asHost();
    const summary = (id: string) => ({
      id,
      ownerName: id,
      memberCount: 1,
      drinkId: 'latte',
      timer: TIMER,
    });
    h.es().emit('rooms', { now: Date.now(), rooms: [summary('r1'), summary('r2')] });
    expect(h.rooms.list.map((r) => r.id)).toEqual(['r2']);
  });

  it('becomes a co-host and unlocked when promoted, then patches changes', async () => {
    await h.connect();
    await h.rooms.join('other');
    expect(h.rooms.locked).toBe(true);
    h.es().emit('room', {
      now: Date.now(),
      you: 'me',
      room: mkRoom({ id: 'other', members: [member('o', 'host', 1), member('me', 'cohost', 2)] }),
    });
    flushSync();
    expect(h.rooms.role).toBe('cohost');
    expect(h.rooms.locked).toBe(false);
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    h.timer.pause();
    expect(h.api.patchRoom).toHaveBeenCalledWith(h.identity.token, 'other', {
      timer: h.timer.state,
    });
  });
});

describe('roles', () => {
  it('lets the host change a role through the API and updates the room', async () => {
    await h.asHost();
    const next = mkRoom({ members: [member('me', 'host', 1), member('v', 'cohost', 2)] });
    h.api.setRole.mockResolvedValueOnce(next);
    await h.rooms.setRole('v', 'cohost');
    expect(h.api.setRole).toHaveBeenCalledWith(h.identity.token, 'r1', 'v', 'cohost');
    expect(h.rooms.room).toEqual(next);
  });
});

describe('joining and leaving', () => {
  it('saves my settings, joins and mirrors the room as a locked visitor', async () => {
    await h.connect();
    await h.rooms.join('other');
    expect(load('ownSettings', null)).toEqual({
      drinkId: 'latte',
      backgroundId: 'rainy-window',
      backgroundRotateMin: 5,
      mix: { hum: 0.3 },
    });
    expect(h.api.joinRoom).toHaveBeenCalledWith(h.identity.token, 'other', {
      name: h.identity.name,
    });
    expect(h.rooms.role).toBe('guest');
    expect(h.rooms.locked).toBe(true);
    expect(h.rooms.hostName).toBe('Name o');
    expect(h.drinks.selectedId).toBe('mocha');
    expect(h.backgrounds.selectedId).toBe('night-lights');
    expect(h.sound.mix).toEqual({ rain: 0.5 });
    expect(h.timer.state).toEqual(TIMER);
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    expect(h.api.createRoom).not.toHaveBeenCalled();
  });

  it('restores my own settings when a visitor leaves', async () => {
    await h.connect();
    await h.rooms.join('other');
    await h.rooms.leave();
    expect(h.api.leaveRoom).toHaveBeenCalledWith(h.identity.token, 'other');
    expect(h.drinks.selectedId).toBe('latte');
    expect(h.backgrounds.selectedId).toBe('rainy-window');
    expect(h.backgrounds.rotateMin).toBe(5);
    expect(h.sound.mix).toEqual({ hum: 0.3 });
    expect(h.timer.state).toBeNull();
    expect(h.rooms.locked).toBe(false);
    expect(load('ownSettings', null)).toBeNull();
  });

  it('restores locally, without a request, when the room disappears under a visitor', async () => {
    await h.connect();
    await h.rooms.join('other');
    h.es().emit('room', { now: Date.now(), you: 'me', room: null });
    await h.settle();
    expect(h.api.leaveRoom).not.toHaveBeenCalled();
    expect(h.drinks.selectedId).toBe('latte');
    expect(h.sound.mix).toEqual({ hum: 0.3 });
    expect(h.timer.state).toBeNull();
    expect(h.rooms.role).toBeNull();
  });

  it('shows the user-facing error and leaves settings alone when the timer ended', async () => {
    await h.connect();
    h.api.joinRoom.mockRejectedValueOnce(new ApiError(404, 'no such room'));
    await h.rooms.join('gone');
    expect(h.rooms.error).toBe('That timer has ended.');
    expect(h.drinks.selectedId).toBe('latte');
    expect(h.rooms.role).toBeNull();
    expect(load('ownSettings', null)).toBeNull();
    h.api.joinRoom.mockRejectedValueOnce(new ApiError(429, 'full'));
    await h.rooms.join('full');
    expect(h.rooms.error).toBe('That timer is full.');
  });

  it('keeps rotation off for visitors and co-hosts, and restores it on leave', async () => {
    await h.connect();
    await h.rooms.join('other');
    expect(h.backgrounds.rotateMin).toBe(0);
    h.es().emit('room', {
      now: Date.now(),
      you: 'me',
      room: mkRoom({
        id: 'other',
        settings: { ...SETTINGS, backgroundRotateMin: 10 },
        members: [member('o', 'host', 1), member('me', 'cohost', 2)],
      }),
    });
    flushSync();
    expect(h.backgrounds.rotateMin).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    await h.rooms.leave();
    expect(h.backgrounds.rotateMin).toBe(5);
  });
});

describe('the stream', () => {
  it('goes offline on error and reconnects after 2s, then 4s', async () => {
    h.es().emit('open');
    expect(h.rooms.online).toBe(true);
    const first = h.es();
    first.emit('error');
    expect(h.rooms.online).toBe(false);
    expect(first.closed).toBe(true);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeSource.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.all).toHaveLength(2);
    h.es().emit('error');
    await vi.advanceTimersByTimeAsync(3999);
    expect(FakeSource.all).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeSource.all).toHaveLength(3);
  });

  it('puts the token in the URL but never in an error', async () => {
    expect(h.es().url).toContain(`token=${h.identity.token}`);
    await h.connect();
    h.api.joinRoom.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await h.rooms.join('x');
    expect(h.rooms.error).not.toContain(h.identity.token);
  });
});
