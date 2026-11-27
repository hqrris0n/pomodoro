import { flushSync, untrack } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { backgrounds } from '../backgrounds/backgrounds.svelte';
import { drinks } from '../drinks/drinks.svelte';
import { sound } from '../audio/mixes.svelte';
import { notes, type Note } from '../notes/notes.svelte';
import { profileSync } from '../profiles/sync';
import { identity } from '../shell/identity.svelte';
import { load, save } from '../storage';
import { timer, type TimerCause } from '../timer/engine.svelte';
import { elapsedAt, snapshot } from '../timer/schedule';
import type { Mix, SavedMix, Settings, SettingsPatch, TimerState } from '../types';
import * as realApi from './api';
import {
  ApiError,
  type ListedRoom,
  type Role,
  type Room,
  type RoomSummary,
  type RoomsApi,
} from './api';

const SNAPSHOT_KEY = 'ownSettings';
const DEBOUNCE_MS = 300;
const RENEW_MS = 2000;
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
    onChange(fn: (state: TimerState | null, cause?: TimerCause) => void): () => void;
    setClockOffset(ms: number): void;
  };
  drinks: { selectedId: string; selected?: { id: string } | null; select(id: string): void };
  backgrounds: {
    selectedId: string;
    rotateMin: number;
    select(id: string): void;
    setRotate(min: number): void;
  };
  sound: {
    mix: Mix;
    applyMix(mix: Mix): void;
    /** The user's own saved mixes, in the form a room accepts. */
    ownMixes: SavedMix[];
    roomMixes: SavedMix[] | null;
    roomAppend: ((mix: SavedMix) => void) | null;
    setRoomMixes(list: SavedMix[] | null): void;
    adoptMixes(list: SavedMix[]): void;
  };
  api: RoomsApi;
  /** Called with each valid sticky note that arrives. */
  onNote?: (note: Note) => void;
  /** Called when the server ends this device's login because it was used elsewhere. */
  onSessionRevoked?: () => void;
  createEventSource?: (url: string) => EventSource;
  now?: () => number;
};

type SettingsSource = {
  drinks: RoomsDeps['drinks'];
  backgrounds: RoomsDeps['backgrounds'];
  sound: Pick<RoomsDeps['sound'], 'mix'>;
};

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

const sigMixes = (m: SavedMix[] | undefined) => JSON.stringify(m ?? null);

/**
 * What differs between `cur` and the settings known to be on the server, as a
 * patch (null when nothing does). Only changed scalar fields and changed mix
 * channels are included; a channel that is off now is sent as 0. `mixes` goes
 * only when `cur` has a list and it differs. With no baseline everything is sent.
 */
export function diffSettings(cur: Settings, base: Settings | null): SettingsPatch | null {
  const out: SettingsPatch = {};
  if (!base || cur.drinkId !== base.drinkId) out.drinkId = cur.drinkId;
  if (!base || cur.backgroundId !== base.backgroundId) out.backgroundId = cur.backgroundId;
  if (!base || cur.backgroundRotateMin !== base.backgroundRotateMin) {
    out.backgroundRotateMin = cur.backgroundRotateMin;
  }
  const now = cleanMix(cur.mix);
  const was = base ? cleanMix(base.mix) : {};
  const mix: Mix = {};
  for (const k of Object.keys(now)) if (now[k] !== was[k]) mix[k] = now[k];
  for (const k of Object.keys(was)) if (!(k in now)) mix[k] = 0;
  if (Object.keys(mix).length > 0) out.mix = mix;
  if (cur.mixes !== undefined && sigMixes(cur.mixes) !== sigMixes(base?.mixes)) {
    out.mixes = cur.mixes;
  }
  return Object.keys(out).length > 0 ? out : null;
}

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
  #all = $state.raw<ListedRoom[]>([]);

  /** Other rooms with a timer to follow; rooms waiting for their host to order are left out. */
  list = $derived(
    this.#all.filter((r): r is RoomSummary => r.id !== this.room?.id && r.timer !== null),
  );
  locked = $derived(this.role === 'guest');
  hostName = $derived(
    this.role === 'guest'
      ? (this.room?.members.find((m) => m.role === 'host')?.name ?? null)
      : null,
  );
  /** The room's host, whatever my role. */
  roomHost = $derived(this.room?.members.find((m) => m.role === 'host')?.name ?? null);
  /** True while I am in a room whose host is choosing the next order (it has no timer). */
  waiting = $derived(
    this.room !== null && this.room.timer === null && this.role !== null && this.role !== 'host',
  );
  /** Host and co-hosts drive the timer and settings; guests only follow. */
  #controls = $derived(this.role === 'host' || this.role === 'cohost');
  /** Channel claims in the latest room view: channel id -> member id. */
  claims = $derived<Record<string, string>>(this.room?.claims ?? {});
  /** True while another member is adjusting any sound channel. */
  anyHeldByOther = $derived(Object.values(this.claims).some((m) => m !== this.me));

  /** Channels I am adjusting: the claim request, and the timer that renews it. */
  #holds = new SvelteMap<
    string,
    { roomId: string; claimed: Promise<boolean>; renew: ReturnType<typeof setInterval> }
  >();

  #d: RoomsDeps;
  #es: EventSource | null = null;
  #retryTimer: ReturnType<typeof setTimeout> | null = null;
  #backoff = RETRY_MIN_MS;
  #running = false;
  #debounce: ReturnType<typeof setTimeout> | null = null;
  /** The settings the server is known to hold (or that came from it); null: unknown. */
  #synced: Settings | null = null;
  #creating = false;
  #joining = false;
  /** Highest `timerRev` applied or caused for the current room; older timers are stale. */
  #seenRev = 0;
  /** Timer patches in flight, sent one at a time so the server applies them in order. */
  #patching = 0;
  #patchingRoom: string | null = null;
  #timerQueue: Promise<void> = Promise.resolve();
  /** A room I just left: its events may still be in flight and must not pull me back. */
  #leftRoom: string | null = null;
  /** The saved list last sent to the room as host (undefined: nothing sent as host yet). */
  #syncedMixes: SavedMix[] | undefined;
  /** Ids of the room's mixes this host has already seen or published; never adopted again. */
  #knownMixIds: string[] = [];

  constructor(deps: RoomsDeps) {
    this.#d = deps;
  }

  /** True when another member holds `channel` in the latest room view. */
  heldByOther(channel: string): boolean {
    const holder = this.claims[channel];
    return holder !== undefined && holder !== this.me;
  }

  /** True for host and co-host: the people who can be told why a control is greyed out. */
  get canControl(): boolean {
    return this.#controls;
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
    const offChange = d.timer.onChange((state, cause) => this.#onTimerChange(state, cause));
    const stopEffects = $effect.root(() => {
      let prevVisible = d.identity.visible;
      let prevName = d.identity.name;
      $effect(() => {
        // Shared settings: watch, then debounce a patch.
        void this.role;
        void this.room?.id;
        const next = this.#effective();
        untrack(() => {
          this.#onSettingsChanged(next);
          this.#dropStaleHolds();
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
      this.#dropHolds();
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
      this.#all = data.rooms as ListedRoom[];
    });
    es.addEventListener('note', (e) => this.#onNote(e));
    es.addEventListener('session', (e) => {
      if (parse(e)?.state === 'revoked') this.#d.onSessionRevoked?.();
    });
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
    if (room && room.id === this.#leftRoom) return;
    this.#leftRoom = null;
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
  #adopt(room: Room, role: Role, force = false) {
    const d = this.#d;
    const sameRoom = this.room?.id === room.id;
    if (!sameRoom) {
      this.#seenRev = 0;
      this.#knownMixIds = [];
      this.#syncedMixes = undefined;
    }
    // While my own timer change is on its way, or when this view predates one
    // already seen, the local timer is newer than the event's: keep it.
    const mine = this.#patching > 0 && this.#patchingRoom === room.id;
    const rev = room.timerRev ?? 0;
    const fresh = force || (!mine && rev >= this.#seenRev);
    this.room = room;
    this.role = role;
    if (role === 'guest' && !load<OwnSettings | null>(SNAPSHOT_KEY, null)) {
      this.#saveOwn();
    }
    this.joined = load<OwnSettings | null>(SNAPSHOT_KEY, null) !== null;
    if (fresh) {
      this.#seenRev = rev;
      d.timer.apply(room.timer);
    }
    // A local change still waiting in the debounce is not overwritten by the
    // room's view: those fields and channels stay as they are and go out when
    // the debounce fires. (Own mixes list is handled by #adoptMixes.)
    const keep =
      this.#debounce && sameRoom && this.#controls && role !== 'guest'
        ? diffSettings({ ...this.#effective(), mixes: undefined }, this.#synced)
        : null;
    const rs = room.settings;
    if (keep?.drinkId === undefined) d.drinks.select(rs.drinkId);
    if (keep?.backgroundId === undefined) d.backgrounds.select(rs.backgroundId);
    const mix = { ...rs.mix };
    const kept: Mix = keep?.mix ?? {};
    for (const [k, v] of Object.entries(kept)) {
      if (v === 0) delete mix[k];
      else mix[k] = v;
    }
    d.sound.applyMix(mix);
    if (keep?.backgroundRotateMin === undefined) {
      d.backgrounds.setRotate(this.#drivesRotation(room) ? rs.backgroundRotateMin : 0);
    }
    const mixesPending = this.#adoptMixes(room, role);
    // The baseline is what the room holds; pending local fields differ from it
    // and so remain to be sent. A host's own list is not overwritten by the
    // room, so a change of it that has not been sent yet stays pending.
    const base = this.#effective();
    if (keep?.drinkId !== undefined) base.drinkId = rs.drinkId;
    if (keep?.backgroundId !== undefined) base.backgroundId = rs.backgroundId;
    if (keep?.backgroundRotateMin !== undefined) base.backgroundRotateMin = rs.backgroundRotateMin;
    if (keep?.mix) {
      const bm = cleanMix(base.mix);
      for (const k of Object.keys(keep.mix)) {
        if (rs.mix[k] > 0) bm[k] = rs.mix[k];
        else delete bm[k];
      }
      base.mix = bm;
    }
    base.mixes = role === 'host' ? this.#syncedMixes : undefined;
    this.#synced = base;
    if (this.#debounce && !mixesPending && !keep) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
  }

  /**
   * Host: add the room's new mixes to my own list. Others: show the room's list
   * instead of mine. Returns true when a host's own list differs from what was sent.
   */
  #adoptMixes(room: Room, role: Role): boolean {
    const d = this.#d;
    const list = room.settings.mixes;
    if (role !== 'host') {
      this.#syncedMixes = undefined;
      d.sound.setRoomMixes(list ?? null);
      d.sound.roomAppend = role === 'cohost' && list ? (m) => this.#appendMix(m) : null;
      return false;
    }
    d.sound.setRoomMixes(null);
    this.#syncedMixes ??= list ?? d.sound.ownMixes;
    const pending = sigMixes(d.sound.ownMixes) !== sigMixes(this.#syncedMixes);
    if (list) {
      const own = d.sound.ownMixes.map((m) => m.id);
      d.sound.adoptMixes(
        list.filter((m) => !own.includes(m.id) && !this.#knownMixIds.includes(m.id)),
      );
      this.#knownMixIds.push(...list.map((m) => m.id));
      // Mixes adopted from the room need no echo back unless I had unsent changes of my own.
      if (!pending) this.#syncedMixes = d.sound.ownMixes;
    }
    return sigMixes(d.sound.ownMixes) !== sigMixes(this.#syncedMixes);
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
    // The saved list is the host's to publish; a co-host's patches leave it as it is.
    if (!this.#controls || this.role === 'host' || !this.room) s.mixes = this.#d.sound.ownMixes;
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
    d.sound.setRoomMixes(null);
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

  #onTimerChange(state: TimerState | null, cause?: TimerCause) {
    const d = this.#d;
    if (this.role === 'guest') return;
    const room = this.room;
    if (state === null) {
      if (!room) return;
      if (this.role === 'host') {
        // The room stays open, with no timer, while the host orders the next one.
        this.#patchTimer(room.id, null);
        return;
      }
      this.#leftRoom = room.id;
      d.api.leaveRoom(d.identity.token, room.id).catch(() => {});
      if (this.joined) this.#restoreOwn();
      this.room = null;
      this.role = null;
      return;
    }
    if (room && this.#controls) {
      if (cause) this.#commandTimer(room.id, cause);
      else this.#patchTimer(room.id, state);
    } else if (!room && this.#canPublish()) {
      void this.#create(state);
    }
  }

  /** Send a timer change (null clears it), after any earlier one has been answered. */
  #patchTimer(roomId: string, timer: TimerState | null) {
    const d = this.#d;
    this.#enqueueTimer(roomId, async () => {
      const room = await d.api.patchRoom(d.identity.token, roomId, { timer });
      if (this.room?.id === room.id) {
        this.#seenRev = Math.max(this.#seenRev, room.timerRev ?? 0);
      }
    });
  }

  /**
   * Send Pause, Resume or Skip break as a command carrying the timerRev the local timer
   * is based on. A 409 means the timer was replaced meanwhile: take the server's room.
   */
  #commandTimer(roomId: string, action: TimerCause) {
    const d = this.#d;
    this.#enqueueTimer(roomId, async () => {
      const rev = this.#seenRev || this.room?.timerRev || 0;
      try {
        const room = await d.api.timerCommand(d.identity.token, roomId, { action, rev });
        if (this.room?.id === room.id) {
          this.#seenRev = Math.max(this.#seenRev, room.timerRev ?? 0);
          // A no-op on the server publishes no event, so take its timer, unless a
          // later request is queued behind this one (the local timer is ahead).
          if (this.#patching === 1) d.timer.apply(room.timer);
        }
      } catch (e) {
        const body = e instanceof ApiError && e.status === 409 ? e.body : null;
        const room = (body as { room?: Room } | null)?.room;
        if (room && this.room?.id === room.id) this.#adopt(room, this.#roleIn(room), true);
        else throw e;
      }
    });
  }

  /** Run one timer request after any earlier one has been answered. */
  #enqueueTimer(roomId: string, run: () => Promise<void>) {
    const send = async () => {
      try {
        await run();
      } catch {
        // the solo timer keeps working; the next change or event resyncs
      } finally {
        this.#patching--;
      }
    };
    const idle = this.#patching === 0;
    this.#patching++;
    this.#patchingRoom = roomId;
    this.#timerQueue = idle ? send() : this.#timerQueue.then(send);
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
      this.#seenRev = room.timerRev ?? 0;
      this.#synced = settings;
      this.#syncedMixes = settings.mixes;
      this.#knownMixIds = settings.mixes?.map((m) => m.id) ?? [];
    } catch {
      // solo timer keeps working
    } finally {
      this.#creating = false;
    }
  }

  #onSettingsChanged(current: Settings) {
    if (!this.#controls || !this.room) return;
    if (!diffSettings(current, this.#synced)) return;
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.#sendSettings();
    }, DEBOUNCE_MS);
  }

  /** Send what differs from the server's settings now. A refusal is ignored; the next room event resyncs. */
  async #sendSettings(): Promise<void> {
    const room = this.room;
    if (!this.#controls || !room) return;
    const settings = this.#effective();
    const patch = diffSettings(settings, this.#synced);
    if (!patch) return;
    this.#synced = settings;
    if (this.role === 'host') {
      this.#syncedMixes = settings.mixes;
      this.#knownMixIds.push(...(settings.mixes ?? []).map((m) => m.id));
    }
    try {
      await this.#d.api.patchRoom(this.#d.identity.token, room.id, { settings: patch });
    } catch {
      // 409: someone else holds a channel in it. Anything else: the next change resyncs.
    }
  }

  // ---- channel claims -------------------------------------------------

  /** Start adjusting `channel`: claim it, once, and renew the claim while it is held. */
  startAdjusting(channel: string): void {
    const room = this.room;
    if (!this.#controls || !room || this.#holds.has(channel)) return;
    const claimed = this.#claim(room.id, channel);
    const renew = setInterval(() => {
      this.#dropStaleHolds();
      if (!this.#holds.has(channel)) return;
      void this.#claim(room.id, channel);
    }, RENEW_MS);
    this.#holds.set(channel, { roomId: room.id, claimed, renew });
  }

  /** Claim or renew; on a refusal stop holding, restore the room's value and resolve false. */
  async #claim(roomId: string, channel: string): Promise<boolean> {
    const d = this.#d;
    try {
      await d.api.claimChannel(d.identity.token, roomId, channel);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) this.#refused(roomId, channel);
      return false;
    }
  }

  #refused(roomId: string, channel: string) {
    const hold = this.#holds.get(channel);
    if (!hold || hold.roomId !== roomId) return;
    clearInterval(hold.renew);
    this.#holds.delete(channel);
    const room = this.room;
    if (!room || room.id !== roomId) return;
    const d = this.#d;
    const level = room.settings.mix[channel] ?? 0;
    if ((d.sound.mix[channel] ?? 0) !== level)
      d.sound.applyMix({ ...d.sound.mix, [channel]: level });
  }

  /** Done adjusting `channel`: send any pending change first, then release the claim. */
  async stopAdjusting(channel: string): Promise<void> {
    const d = this.#d;
    const hold = this.#holds.get(channel);
    if (!hold) return;
    clearInterval(hold.renew);
    this.#holds.delete(channel);
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = null;
    const [, held] = await Promise.all([this.#sendSettings(), hold.claimed]);
    if (held) d.api.releaseChannel(d.identity.token, hold.roomId, channel).catch(() => {});
  }

  #dropHolds() {
    for (const h of this.#holds.values()) clearInterval(h.renew);
    this.#holds.clear();
  }

  /** Stop renewing claims I can no longer hold: I left the room, changed room or became a guest. */
  #dropStaleHolds() {
    for (const [channel, h] of this.#holds) {
      if (this.#controls && this.room?.id === h.roomId) continue;
      clearInterval(h.renew);
      this.#holds.delete(channel);
    }
  }

  #onVisible(visible: boolean) {
    const d = this.#d;
    if (!visible) {
      if (this.#controls && this.room && this.room.members.length <= 1) {
        const id = this.room.id;
        this.#leftRoom = id;
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
      this.#leftRoom = null;
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
      this.#leftRoom = room.id;
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

  /** Co-host: add a mix to the host's list, showing it at once and undoing that if the room refuses. */
  #appendMix(mix: SavedMix) {
    const d = this.#d;
    const room = this.room;
    if (!room || this.role !== 'cohost') return;
    const next = [...(d.sound.roomMixes ?? room.settings.mixes ?? []), mix];
    d.sound.setRoomMixes(next);
    d.api
      .patchRoom(d.identity.token, room.id, { settings: { appendMixes: [mix] } })
      .then((res) => {
        if (this.room?.id === room.id && this.role === 'cohost' && res.settings.mixes) {
          d.sound.setRoomMixes(res.settings.mixes);
        }
      })
      .catch((e: unknown) => {
        if (this.room?.id === room.id && this.role === 'cohost') {
          d.sound.setRoomMixes(this.room.settings.mixes ?? null);
        }
        this.#fail(e, 'other');
      });
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
  onSessionRevoked: () => profileSync.revoked(),
});
