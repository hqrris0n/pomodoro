import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundStore } from '../audio/mixes.svelte';
import { BackgroundStore } from '../backgrounds/backgrounds.svelte';
import { DrinkStore } from '../drinks/drinks.svelte';
import { Identity } from '../shell/identity.svelte';
import { load } from '../storage';
import { TimerEngine } from '../timer/engine.svelte';
import type { Drink, SavedMix, Settings, TimerState } from '../types';
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
  timerRev: 1,
  members: [member('me', 'host', 1)],
  ...over,
});

function setup() {
  const onNote = vi.fn();
  const api = {
    createRoom: vi.fn(async () => mkRoom()),
    joinRoom: vi.fn(async () =>
      mkRoom({ id: 'other', members: [member('o', 'host', 1), member('me', 'guest', 2)] }),
    ),
    leaveRoom: vi.fn(async () => ({})),
    patchRoom: vi.fn(async () => mkRoom()),
    setRole: vi.fn(async () => mkRoom()),
    rename: vi.fn(async () => ({})),
    sendNote: vi.fn(async () => ({ id: 'n1' })),
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
    onNote,
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
    onNote,
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
        mixes: h.sound.ownMixes,
      },
      timer: h.timer.state,
    });
    expect(h.sound.ownMixes.map((m) => m.name)).toEqual([
      'Quiet morning',
      'Busy café',
      'Rainy day',
    ]);
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

  it('keeps the room open, clearing its timer, when the host stops the timer', async () => {
    await h.asHost();
    h.timer.stop();
    expect(h.api.patchRoom).toHaveBeenCalledWith(h.identity.token, 'r1', { timer: null });
    expect(h.api.leaveRoom).not.toHaveBeenCalled();
    expect(h.rooms.room?.id).toBe('r1');
    expect(h.rooms.role).toBe('host');
    expect(h.rooms.waiting).toBe(false);
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

  it('keeps the timer stopped in both tabs after the host restarts', async () => {
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

      // Restart (confirmed) in tab A.
      a.timer.stop();
      otherTabsSee('timer');
      expect(b.timer.state).toBeNull();
      // The server keeps r1 open with no timer; B holds the stream and hears it.
      const idle = mkRoom({ timer: null, timerRev: 2 });
      b.es().emit('room', { now: Date.now(), you: 'me', room: idle });
      await b.settle();

      // Tab A gets the stream back later and receives the same idle room.
      a.es().emit('room', { now: Date.now(), you: 'me', room: idle });
      await a.settle();

      expect(a.timer.state).toBeNull();
      expect(b.timer.state).toBeNull();
      expect(a.rooms.room?.id).toBe('r1');
      expect(b.api.createRoom).not.toHaveBeenCalled();
      expect(b.api.patchRoom).not.toHaveBeenCalled();
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

describe('sticky notes', () => {
  const NOTE = {
    id: 'n1',
    roomId: 'r1',
    fromId: 'o',
    fromName: 'Name o',
    text: 'hello',
    sentAt: 5,
  };

  it('hands a note event to the callback', async () => {
    await h.connect();
    h.es().emit('note', NOTE);
    expect(h.onNote).toHaveBeenCalledExactlyOnceWith(NOTE);
  });

  it('ignores malformed notes', async () => {
    await h.connect();
    h.es().emit('note', { ...NOTE, text: 5 });
    h.es().emit('note', { ...NOTE, id: undefined });
    h.es().emit('note', null);
    h.es().emit('note', 'junk');
    expect(h.onNote).not.toHaveBeenCalled();
  });

  it('sends a note and returns null on success', async () => {
    await h.asHost();
    expect(await h.rooms.sendNote('v', 'hi')).toBeNull();
    expect(h.api.sendNote).toHaveBeenCalledWith(h.identity.token, 'r1', { to: 'v', text: 'hi' });
  });

  it('maps errors to messages', async () => {
    await h.asHost();
    h.api.sendNote.mockRejectedValueOnce(new ApiError(429, 'slow down'));
    expect(await h.rooms.sendNote('v', 'hi')).toBe(
      "You're sending notes too fast. Wait a minute and try again.",
    );
    h.api.sendNote.mockRejectedValueOnce(new ApiError(404, 'gone'));
    expect(await h.rooms.sendNote('v', 'hi')).toBe("They've left this timer.");
    h.api.sendNote.mockRejectedValueOnce(new ApiError(400, 'Too long.'));
    expect(await h.rooms.sendNote('v', 'hi')).toBe('Too long.');
    h.api.sendNote.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await h.rooms.sendNote('v', 'hi')).toBe("Can't reach the café right now.");
  });
});

describe('between timers', () => {
  const NEXT: TimerState = { ...TIMER, focusMs: 3_000_000, anchorAt: Date.now() };
  const guestIn = (over: Partial<Room> = {}, role: Member['role'] = 'guest') =>
    mkRoom({ id: 'other', members: [member('o', 'host', 1), member('me', role, 2)], ...over });
  const emitRoom = async (room: Room | null) => {
    h.es().emit('room', { now: Date.now(), you: 'me', room });
    await h.settle();
  };
  /** Make the next patchRoom call wait until the returned function is called. */
  const holdPatch = () => {
    let release!: (room: Room) => void;
    h.api.patchRoom.mockImplementationOnce(() => new Promise<Room>((r) => (release = r)));
    return (room: Room) => release(room);
  };

  it('has a guest wait while the host orders, then follow the next timer', async () => {
    await h.connect();
    await h.rooms.join('other');
    await emitRoom(guestIn({ timer: null, timerRev: 2 }));
    expect(h.timer.state).toBeNull();
    expect(h.rooms.waiting).toBe(true);
    expect(h.rooms.roomHost).toBe('Name o');
    expect(h.rooms.joined).toBe(true);
    expect(h.drinks.selectedId).toBe('mocha');
    expect(load('ownSettings', null)).not.toBeNull();

    await emitRoom(guestIn({ timer: NEXT, timerRev: 3 }));
    expect(h.timer.state).toEqual(NEXT);
    expect(h.rooms.waiting).toBe(false);
    expect(h.api.leaveRoom).not.toHaveBeenCalled();
    expect(h.api.patchRoom).not.toHaveBeenCalled();
  });

  it('has a co-host wait too, without sending anything', async () => {
    await h.connect();
    await h.rooms.join('other');
    await emitRoom(guestIn({ timer: null, timerRev: 2 }, 'cohost'));
    expect(h.rooms.waiting).toBe(true);
    expect(h.rooms.roomHost).toBe('Name o');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.api.patchRoom).not.toHaveBeenCalled();
    expect(h.api.createRoom).not.toHaveBeenCalled();
  });

  it('restores my own settings when I leave while waiting', async () => {
    await h.connect();
    await h.rooms.join('other');
    await emitRoom(guestIn({ timer: null, timerRev: 2 }));
    await h.rooms.leave();
    expect(h.api.leaveRoom).toHaveBeenCalledWith(h.identity.token, 'other');
    expect(h.rooms.room).toBeNull();
    expect(h.rooms.waiting).toBe(false);
    expect(h.drinks.selectedId).toBe('latte');
    expect(h.sound.mix).toEqual({ hum: 0.3 });
    expect(load('ownSettings', null)).toBeNull();
  });

  it('ignores events for a room I left that were sent before the leave', async () => {
    await h.connect();
    await h.rooms.join('other');
    await h.rooms.leave();
    await emitRoom(guestIn({ timer: NEXT, timerRev: 5 }));
    expect(h.timer.state).toBeNull();
    expect(h.rooms.room).toBeNull();
    expect(h.drinks.selectedId).toBe('latte');
    // After the server confirms, I can join that room again.
    await emitRoom(null);
    await h.rooms.join('other');
    expect(h.rooms.room?.id).toBe('other');
    await emitRoom(guestIn({ timer: NEXT, timerRev: 6 }));
    expect(h.timer.state).toEqual(NEXT);
  });

  it('keeps a restarted host stopped despite late views, then starts the next timer in the same room', async () => {
    await h.asHost();
    const release = holdPatch();
    h.timer.stop();
    expect(h.api.patchRoom).toHaveBeenCalledWith(h.identity.token, 'r1', { timer: null });

    // A view from before the clear arrives while the clear is in flight, and again after.
    await emitRoom(mkRoom({ timerRev: 1 }));
    expect(h.timer.state).toBeNull();
    release(mkRoom({ timer: null, timerRev: 2 }));
    await h.settle();
    await emitRoom(mkRoom({ timerRev: 1 }));
    expect(h.timer.state).toBeNull();
    await emitRoom(mkRoom({ timer: null, timerRev: 2 }));
    expect(h.timer.state).toBeNull();
    expect(h.rooms.room?.id).toBe('r1');
    expect(h.rooms.role).toBe('host');

    h.api.patchRoom.mockResolvedValueOnce(mkRoom({ timer: NEXT, timerRev: 3 }));
    await h.startTimer();
    const mine = h.timer.state;
    expect(h.api.patchRoom).toHaveBeenLastCalledWith(h.identity.token, 'r1', { timer: mine });
    expect(h.api.createRoom).not.toHaveBeenCalled();
    expect(h.api.leaveRoom).not.toHaveBeenCalled();
    // The clear's own echo, arriving after the new timer was accepted, is stale.
    await emitRoom(mkRoom({ timer: null, timerRev: 2 }));
    expect(h.timer.state).toEqual(mine);
  });

  it('sends timer changes one at a time so the server applies them in order', async () => {
    await h.asHost();
    const release = holdPatch();
    h.timer.pause();
    h.timer.stop();
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    release(mkRoom({ timerRev: 2 }));
    await h.settle();
    expect(h.api.patchRoom).toHaveBeenCalledTimes(2);
    expect(h.api.patchRoom).toHaveBeenLastCalledWith(h.identity.token, 'r1', { timer: null });
  });

  it('leaves rooms waiting for their host out of the list', async () => {
    await h.connect();
    const summary = (id: string, timer: TimerState | null) => ({
      id,
      ownerName: id,
      memberCount: 1,
      drinkId: 'latte',
      timer,
    });
    h.es().emit('rooms', { now: Date.now(), rooms: [summary('a', TIMER), summary('b', null)] });
    expect(h.rooms.list.map((r) => r.id)).toEqual(['a']);
  });
});

describe("sharing the host's saved mixes", () => {
  const SHARED: SavedMix[] = [
    { id: 'builtin:rainy-day', name: 'Rainy day', mix: { rain: 0.7 } },
    { id: 'h1', name: 'Host mix', mix: { hum: 0.4 } },
  ];
  const view = (role: 'guest' | 'cohost' | 'host', mixes = SHARED) =>
    mkRoom({
      id: 'other',
      settings: { ...SETTINGS, mixes },
      members:
        role === 'host'
          ? [member('me', 'host', 1)]
          : [member('o', 'host', 1), member('me', role, 2)],
    });
  const emitView = (room: Room) => {
    h.es().emit('room', { now: Date.now(), you: 'me', room });
    flushSync();
  };
  const patchedSettings = (n: number) =>
    ((h.api.patchRoom.mock.calls[n] as unknown[])[2] as { settings: Settings }).settings;

  it("shows the host's list to a guest and brings my own back on leaving", async () => {
    const own = load('mixes', null);
    await h.connect();
    await h.rooms.join('other');
    emitView(view('guest'));
    expect(h.sound.saved.map((m) => m.name)).toEqual(['Rainy day', 'Host mix']);
    expect(h.sound.roomAppend).toBeNull();
    expect(load('mixes', null)).toEqual(own);
    await h.rooms.leave();
    expect(h.sound.roomMixes).toBeNull();
    expect(h.sound.saved.map((m) => m.name)).toEqual(['Quiet morning', 'Busy café', 'Rainy day']);
    expect(load('mixes', null)).toEqual(own);
  });

  it("restores my list when the room disappears, and keeps a co-host's settings patches free of mixes", async () => {
    await h.connect();
    await h.rooms.join('other');
    emitView(view('cohost'));
    h.drinks.select('tea');
    flushSync();
    await vi.advanceTimersByTimeAsync(300);
    expect(patchedSettings(0).drinkId).toBe('tea');
    expect(patchedSettings(0).mixes).toBeUndefined();
    h.es().emit('room', { now: Date.now(), you: 'me', room: null });
    await h.settle();
    expect(h.sound.roomMixes).toBeNull();
    expect(h.sound.saved).toHaveLength(3);
  });

  it("sends a co-host's new mix as an append and leaves their own list alone", async () => {
    const own = load('mixes', null);
    await h.connect();
    await h.rooms.join('other');
    emitView(view('cohost'));
    h.sound.applyMix({ chatter: 0.6 });
    expect(h.sound.saveCurrent('Study')).toBeNull();
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    const sent = patchedSettings(0).mixes!;
    expect(sent.slice(0, 2)).toEqual(SHARED);
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ name: 'Study', mix: { chatter: 0.6 } });
    expect(h.sound.saved.map((m) => m.name)).toEqual(['Rainy day', 'Host mix', 'Study']);
    expect(load('mixes', null)).toEqual(own);
    expect(h.sound.saveCurrent('study')).toBe('Another mix already has that name.');
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
  });

  it('undoes a co-host save the room refuses', async () => {
    await h.connect();
    await h.rooms.join('other');
    emitView(view('cohost'));
    h.sound.applyMix({ chatter: 0.6 });
    h.api.patchRoom.mockRejectedValueOnce(new ApiError(403, 'nope'));
    h.sound.saveCurrent('Study');
    await h.settle();
    expect(h.sound.saved.map((m) => m.name)).toEqual(['Rainy day', 'Host mix']);
    expect(h.rooms.error).toBe('nope');
  });

  it('a host adds mixes new in a room view to their own list and never deletes', async () => {
    await h.asHost();
    const added = { id: 'c1', name: 'Co-host mix', mix: { rain: 0.2 } };
    const before = h.sound.ownMixes;
    emitView(mkRoom({ settings: { ...SETTINGS, mixes: [...before, added] } }));
    expect(h.sound.ownMixes.map((m) => m.id)).toEqual([...before.map((m) => m.id), 'c1']);
    expect(load<{ id: string }[]>('mixes', [])!.map((m) => m.id)).toContain('c1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.api.patchRoom).not.toHaveBeenCalled();

    // A view without some of my mixes does not delete them.
    emitView(mkRoom({ settings: { ...SETTINGS, mixes: [] } }));
    expect(h.sound.ownMixes).toHaveLength(before.length + 1);

    // A mix I deleted is not brought back by a stale view, and the deletion is sent.
    h.sound.deleteSaved('c1');
    emitView(mkRoom({ settings: { ...SETTINGS, mixes: [...before, added] } }));
    expect(h.sound.ownMixes.map((m) => m.id)).not.toContain('c1');
    await vi.advanceTimersByTimeAsync(300);
    expect(patchedSettings(0).mixes!.map((m) => m.id)).not.toContain('c1');
  });

  it("publishes the host's list again when it changes", async () => {
    await h.asHost();
    h.sound.saveCurrent('Mine');
    flushSync();
    await vi.advanceTimersByTimeAsync(300);
    expect(h.api.patchRoom).toHaveBeenCalledOnce();
    expect(patchedSettings(0).mixes!.map((m) => m.name)).toEqual([
      'Quiet morning',
      'Busy café',
      'Rainy day',
      'Mine',
    ]);
  });

  it('a promoted co-host adopts the room list and sees their own list again', async () => {
    await h.connect();
    await h.rooms.join('other');
    emitView(view('cohost'));
    emitView(view('host'));
    expect(h.sound.roomMixes).toBeNull();
    expect(h.sound.saved.map((m) => m.name)).toEqual([
      'Quiet morning',
      'Busy café',
      'Rainy day',
      'Host mix',
    ]);
  });
});
