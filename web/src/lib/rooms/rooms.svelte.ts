import { flushSync, untrack } from 'svelte';
import { backgrounds } from '../backgrounds/backgrounds.svelte';
import { drinks } from '../drinks/drinks.svelte';
import { sound } from '../audio/mixes.svelte';
import { notes, type Note } from '../notes/notes.svelte';
import { identity } from '../shell/identity.svelte';
import { load, save } from '../storage';
import { timer } from '../timer/engine.svelte';
import { elapsedAt, snapshot } from '../timer/schedule';
import type { Mix, Settings, TimerState } from '../types';
import * as realApi from './api';
import { ApiError, type Role, type Room, type RoomSummary, type RoomsApi } from './api';

const SNAPSHOT_KEY = 'ownSettings';
const DEBOUNCE_MS = 300;
const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30_000;

type OwnSettings = {
  drinkId: string;
  backgroundId: string;
  backgroundRotateMin: number;
  mix: Mix;
};

export type RoomsDeps = {
  identity: { token: string; name: string; visible: boolean };
  timer: {
    state: TimerState | null;
    apply(state: TimerState | null): void;
    stop(): void;
    onChange(fn: (state: TimerState | null) => void): () => void;
    setClockOffset(ms: number): void;
  };
  drinks: { selectedId: string; selected?: { id: string } | null; select(id: string): void };
  backgrounds: {
    selectedId: string;
    rotateMin: number;
    select(id: string): void;
    setRotate(min: number): void;
  };
  sound: { mix: Mix; applyMix(mix: Mix): void };
  api: RoomsApi;
  /** Called with each valid sticky note that arrives. */
  onNote?: (note: Note) => void;
  createEventSource?: (url: string) => EventSource;
  now?: () => number;
};

type SettingsSource = Pick<RoomsDeps, 'drinks' | 'backgrounds' | 'sound'>;

function cleanMix(mix: Mix): Mix {
  const out: Mix = {};
  for (const k of Object.keys(mix).sort()) {
    const v = mix[k];
    if (typeof v === 'number' && v > 0) out[k] = v;
  }
  return out;
}

/** The shared settings as they are on this device right now (zero mix entries dropped). */
export function currentSettings(src: SettingsSource = { drinks, backgrounds, sound }): Settings {
  return {
    drinkId: src.drinks.selectedId || src.drinks.selected?.id || '',
    backgroundId: src.backgrounds.selectedId,
    backgroundRotateMin: src.backgrounds.rotateMin,
    mix: cleanMix(JSON.parse(JSON.stringify(src.sound.mix)) as Mix),
  };
}

const sig = (s: Settings) => JSON.stringify({ ...s, mix: cleanMix(s.mix) });

function isDone(state: TimerState, now: number): boolean {
  return snapshot(state, now).phase === 'done';
}

export class RoomsStore {
  online = $state(false);
  room = $state.raw<Room | null>(null);
  me = $state<string | null>(null);
  role = $state<Role | null>(null);
  error = $state<string | null>(null);
  /** Server clock minus local clock, ms; the same value given to the timer engine. */
  clockOffset = $state(0);
  /** True while I am in someone else's room (as guest or co-host). */
  joined = $state(false);
  #all = $state.raw<RoomSummary[]>([]);

  list = $derived(this.#all.filter((r) => r.id !== this.room?.id));
  locked = $derived(this.role === 'guest');
  hostName = $derived(
    this.role === 'guest'
      ? (this.room?.members.find((m) => m.role === 'host')?.name ?? null)
      : null,
  );
  /** Host and co-hosts drive the timer and settings; guests only follow. */
  #controls = $derived(this.role === 'host' || this.role === 'cohost');

  #d: RoomsDeps;
  #es: EventSource | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = RETRY_MIN_MS;
  #running = false;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  /** Signature of the settings the server is known to hold (or that came from it). */
  #synced = '';
  #creating = false;
  #joining = false;

  constructor(deps: RoomsDeps) {
    this.#d = deps;
  }

  #now(): number {
    return (this.#d.now ?? Date.now)();
  }

  #clock(): number {
    return this.#now() + this.clockOffset;
  }

  // ---- lifecycle ------------------------------------------------------

  start(): () => void {
    if (this.#running) return () => {};
    this.#running = true;
    this.#backoff = RETRY_MIN_MS;
    const d = this.#d;
    const offChange = d.timer.onChange((state) => this.#onTimerChange(state));
    const stopEffects = $effect.root(() => {
      let prevVisible = d.identity.visible;
      let prevName = d.identity.name;
      $effect(() => {
        // Shared settings: watch, then debounce a patch.
        void this.role;
        void this.room?.id;
        const next = this.#effective();
        untrack(() => {
          this.#onSettingsChanged(sig(next));
        });
      });
      $effect(() => {
        const v = d.identity.visible;
        untrack(() => {
          if (v !== prevVisible) this.#onVisible(v);
          prevVisible = v;
        });
      });
      $effect(() => {
        const n = d.identity.name;
        untrack(() => {
          if (n !== prevName && this.room) {
            d.api.rename(d.identity.token, n).catch(() => {});
          }
          prevName = n;
        });
      });
    });
    flushSync();
    this.#connect();
    return () => {
      this.#running = false;
      offChange();
      stopEffects();
      if (this.#debounce) clearTimeout(this.#debounce);
      if (this.#retryTimer) clearTimeout(this.#retryTimer);
      this.#debounce = this.#retryTimer = null;
      this.#es?.close();
      this.#es = null;
      this.online = false;
    };
  }

  #connect() {
    if (!this.#running) return;
    const d = this.#d;
    const url =
      `/api/events?token=${encodeURIComponent(d.identity.token)}` +
      `&name=${encodeURIComponent(d.identity.name)}`;
    const es = (d.createEventSource ?? ((u: string) => new EventSource(u)))(url);
    this.#es = es;
    es.addEventListener('open', () => {
      if (this.#es !== es) return;
      this.online = true;
      this.#backoff = RETRY_MIN_MS;
    });
    es.addEventListener('error', () => {
      if (this.#es !== es) return;
      es.close();
      this.#es = null;
      this.online = false;
      const wait = this.#backoff;
      this.#backoff = Math.min(this.#backoff * 2, RETRY_MAX_MS);
      this.#retryTimer = setTimeout(() => {
        this.#retryTimer = null;
        this.#connect();
      }, wait);
    });
    es.addEventListener('rooms', (e) => {
      const data = parse(e);
      if (!data || !Array.isArray(data.rooms)) return;
      this.#syncClock(data.now);
      this.#all = data.rooms as RoomSummary[];
    });
    es.addEventListener('note', (e) => this.#onNote(e));
    es.addEventListener('room', (e) => {
      const data = parse(e);
      if (!data) return;
      this.#syncClock(data.now);
      if (typeof data.you === 'string') this.me = data.you;
      this.#onRoomEvent((data.room ?? null) as Room | null);
    });
  }

  #onNote(e: Event) {
    const data = parse(e);
    if (!data) return;
    const { id, roomId, fromId, fromName, text, sentAt } = data;
    if (
      typeof id !== 'string' ||
      !id ||
      typeof roomId !== 'string' ||
      typeof fromId !== 'string' ||
      typeof fromName !== 'string' ||
      typeof text !== 'string' ||
      !text ||
      typeof sentAt !== 'number'
    ) {
      return;
    }
    this.#d.onNote?.({ id, roomId, fromId, fromName, text, sentAt });
  }

  #syncClock(now: unknown) {
    if (typeof now !== 'number') return;
    this.clockOffset = now - Date.now();
    this.#d.timer.setClockOffset(this.clockOffset);
  }

  // ---- remote -> local ------------------------------------------------

  #roleIn(room: Room): Role {
    return room.members.find((m) => m.id === this.me)?.role ?? 'guest';
  }

  #onRoomEvent(room: Room | null) {
    if (this.#joining) return;
    if (!room) {
      this.room = null;
      this.role = null;
      if (load<OwnSettings | null>(SNAPSHOT_KEY, null)) {
        this.#restoreOwn();
      } else if (this.#canPublish()) {
        void this.#create(this.#d.timer.state!);
      }
      return;
    }
    this.#adopt(room, this.#roleIn(room));
  }

  /** Make `room` the current room and mirror it locally without sending anything. */
  #adopt(room: Room, role: Role) {
    const d = this.#d;
    this.room = room;
    this.role = role;
    if (role === 'guest' && !load<OwnSettings | null>(SNAPSHOT_KEY, null)) {
      this.#saveOwn();
    }
    this.joined = load<OwnSettings | null>(SNAPSHOT_KEY, null) !== null;
    d.timer.apply(room.timer);
    d.drinks.select(room.settings.drinkId);
    d.backgrounds.select(room.settings.backgroundId);
    d.sound.applyMix({ ...room.settings.mix });
    d.backgrounds.setRotate(this.#drivesRotation(room) ? room.settings.backgroundRotateMin : 0);
    this.#synced = sig(this.#effective());
    if (this.#debounce) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
  }

  #drivesRotation(room: Room): boolean {
    const first = room.members.find((m) => m.role === 'host');
    return first !== undefined && first.id === this.me;
  }

  /** Settings as the room should see them from this client. */
  #effective(): Settings {
    const s = currentSettings(this.#d);
    if (this.#controls && this.room && !this.#drivesRotation(this.room)) {
      s.backgroundRotateMin = this.room.settings.backgroundRotateMin;
    }
    return s;
  }

  #saveOwn() {
    const s = currentSettings(this.#d);
    save<OwnSettings>(SNAPSHOT_KEY, {
      drinkId: s.drinkId,
      backgroundId: s.backgroundId,
      backgroundRotateMin: s.backgroundRotateMin,
      mix: s.mix,
    });
  }

  #restoreOwn() {
    const d = this.#d;
    const own = load<OwnSettings | null>(SNAPSHOT_KEY, null);
    if (own) {
      d.drinks.select(own.drinkId);
      d.backgrounds.select(own.backgroundId);
      d.backgrounds.setRotate(own.backgroundRotateMin);
      d.sound.applyMix(own.mix);
      save<OwnSettings | null>(SNAPSHOT_KEY, null);
    }
    d.timer.apply(null);
    this.room = null;
    this.role = null;
    this.joined = false;
  }

  // ---- local -> remote ------------------------------------------------

  #canPublish(): boolean {
    const state = this.#d.timer.state;
    return (
      this.online &&
      this.#d.identity.visible &&
      this.role !== 'guest' &&
      !this.room &&
      !this.#creating &&
      state !== null &&
      !isDone(state, this.#clock())
    );
  }

  #onTimerChange(state: TimerState | null) {
    const d = this.#d;
    if (this.role === 'guest') return;
    if (state === null) {
      const room = this.room;
      if (room) {
        d.api.leaveRoom(d.identity.token, room.id).catch(() => {});
        if (this.joined) this.#restoreOwn();
        this.room = null;
        this.role = null;
      }
      return;
    }
    if (this.room && this.#controls) {
      const id = this.room.id;
      d.api.patchRoom(d.identity.token, id, { timer: state }).catch(() => {});
    } else if (!this.room && this.#canPublish()) {
      void this.#create(state);
    }
  }

  async #create(state: TimerState) {
    const d = this.#d;
    this.#creating = true;
    const settings = this.#effective();
    // The server re-anchors a running timer at its own now, so send the time
    // elapsed so far; a timer started earlier would otherwise restart in full.
    const now = this.#clock();
    const timer: TimerState = {
      ...state,
      elapsedMs: elapsedAt(state, now),
      anchorAt: state.anchorAt === null ? null : now,
    };
    try {
      const room = await d.api.createRoom(d.identity.token, {
        name: d.identity.name,
        settings,
        timer,
      });
      if (d.timer.state === null || this.role === 'guest' || this.room) {
        // Stopped or joined elsewhere while the request was in flight.
        if (!this.room || this.room.id !== room.id) {
          d.api.leaveRoom(d.identity.token, room.id).catch(() => {});
        }
        return;
      }
      this.room = room;
      this.role = 'host';
      this.#synced = sig(settings);
    } catch {
      // solo timer keeps working
    } finally {
      this.#creating = false;
    }
  }

  #onSettingsChanged(signature: string) {
    if (!this.#controls || !this.room) return;
    if (signature === this.#synced) return;
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      const room = this.room;
      if (!this.#controls || !room) return;
      const settings = this.#effective();
      const s = sig(settings);
      if (s === this.#synced) return;
      this.#synced = s;
      this.#d.api.patchRoom(this.#d.identity.token, room.id, { settings }).catch(() => {});
    }, DEBOUNCE_MS);
  }

  #onVisible(visible: boolean) {
    const d = this.#d;
    if (!visible) {
      if (this.#controls && this.room && this.room.members.length <= 1) {
        const id = this.room.id;
        this.room = null;
        this.role = null;
        d.api.leaveRoom(d.identity.token, id).catch(() => {});
      }
    } else if (this.#canPublish()) {
      void this.#create(d.timer.state!);
    }
  }

  // ---- user actions ---------------------------------------------------

  #fail(e: unknown, context: 'join' | 'other') {
    if (e instanceof ApiError) {
      if (context === 'join' && e.status === 404) this.error = 'That timer has ended.';
      else if (context === 'join' && e.status === 429) this.error = 'That timer is full.';
      else if (e.status === 429) this.error = 'Too many requests. Wait a moment and try again.';
      else this.error = e.message;
    } else {
      this.error = "Can't reach the café right now.";
    }
  }

  async join(roomId: string): Promise<void> {
    const d = this.#d;
    const hadSnapshot = load<OwnSettings | null>(SNAPSHOT_KEY, null) !== null;
    if (this.role !== 'guest' && !hadSnapshot) this.#saveOwn();
    this.#joining = true;
    try {
      const room = await d.api.joinRoom(d.identity.token, roomId, { name: d.identity.name });
      this.error = null;
      this.#adopt(room, this.#roleIn(room));
    } catch (e) {
      if (this.role !== 'guest' && !hadSnapshot) save<OwnSettings | null>(SNAPSHOT_KEY, null);
      this.#fail(e, 'join');
    } finally {
      this.#joining = false;
    }
  }

  async leave(): Promise<void> {
    const d = this.#d;
    const room = this.room;
    if (this.joined && room) {
      try {
        await d.api.leaveRoom(d.identity.token, room.id);
      } catch {
        // the server drops us after the grace period anyway
      }
      this.error = null;
      this.#restoreOwn();
    } else if (this.#controls) {
      d.timer.stop();
    }
  }

  /** Host only: make another member a co-host or a guest. */
  async setRole(memberId: string, role: 'cohost' | 'guest'): Promise<void> {
    const d = this.#d;
    const room = this.room;
    if (this.role !== 'host' || !room) return;
    try {
      const next = await d.api.setRole(d.identity.token, room.id, memberId, role);
      this.error = null;
      if (this.room?.id === next.id) this.room = next;
    } catch (e) {
      this.#fail(e, 'other');
    }
  }

  /** Send a sticky note to another member. Resolves to an error message, or null on success. */
  async sendNote(memberId: string, text: string): Promise<string | null> {
    const d = this.#d;
    const room = this.room;
    if (!room) return "They've left this timer.";
    try {
      await d.api.sendNote(d.identity.token, room.id, { to: memberId, text });
      return null;
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 429) return "You're sending notes too fast. Wait a minute and try again.";
        if (e.status === 404) return "They've left this timer.";
        return e.message;
      }
      return "Can't reach the café right now.";
    }
  }
}

function parse(e: Event): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse((e as MessageEvent).data as string);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const rooms = new RoomsStore({
  identity,
  timer,
  drinks,
  backgrounds,
  sound,
  api: realApi,
  onNote: (n) => notes.add(n),
});
