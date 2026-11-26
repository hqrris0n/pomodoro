// Keeps this device's synced keys (storage.ts SYNCED_KEYS, plus the display
// name) in step with the signed-in user's profile on the server.
//
// This module works on localStorage only and imports no feature stores, so
// main.ts can run bootstrap() before any store reads its saved state. Applying
// a profile mid-session writes the keys and reloads the page so every store
// re-reads them, but never while a timer exists: then it waits for the timer
// to go away.

import { load, onSave, readSynced, saveQuiet, SYNCED_KEYS, writeSynced } from '../storage';
import { ProfileError, realApi, type Profile, type ProfilesApi } from './api';

export const MAX_USERNAME = 24;
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 72;
export const DEBOUNCE_MS = 1000;
export const BOOT_TIMEOUT_MS = 1500;
const MAX_SETTINGS_BYTES = 256 * 1024;
/** Let a stopped timer's leave request go out before the page reloads. */
const RELOAD_DELAY_MS = 400;

// Device-only bookkeeping keys.
const K_CURRENT = 'profile'; // signed-in username, or null
const K_SYNCED_AT = 'profileSyncedAt'; // updatedAt of the server copy this device matches
const K_DIRTY = 'profileDirty'; // time of the latest unsent change, or null
const K_PENDING = 'profilePending'; // switched user, but their profile is not applied yet
const K_USED = 'profileUsed'; // a profile has been used on this device before

const UNREACHABLE = "Can't reach the café right now.";
const ELSEWHERE = 'You were logged in somewhere else.';
const SYNCED = new Set<string>(SYNCED_KEYS);

export type SyncStatus = 'off' | 'saved' | 'saving' | 'offline' | 'waiting' | 'too-big';
export type SignInResult =
  { ok: true; deferred: boolean; displayName: string | null } | { ok: false; error: string };

export type SyncDeps = {
  api: ProfilesApi;
  reload: () => void;
  now?: () => number;
};

/** Error text for a username, or null when it is acceptable. */
export function usernameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a username.';
  if ([...name].length > MAX_USERNAME) return `Keep it to ${MAX_USERNAME} characters or fewer.`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return 'Use letters, numbers and spaces.';
  return null;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function validToken(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{32}$/.test(v);
}

/** Password text for the account card, or null when it is acceptable. */
export function passwordError(password: string): string | null {
  const n = [...password].length;
  if (n < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (n > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters.`;
  return null;
}

/** The server's messages for these statuses are user copy already. */
function errorText(e: unknown): string {
  if (!(e instanceof ProfileError)) return UNREACHABLE;
  if ([400, 401, 409, 429].includes(e.status)) {
    return e.message.charAt(0).toUpperCase() + e.message.slice(1);
  }
  if (e.status === 503) return 'Accounts are unavailable on this server right now.';
  return UNREACHABLE;
}

type OwnSettings = {
  drinkId?: unknown;
  backgroundId?: unknown;
  backgroundRotateMin?: unknown;
  mix?: unknown;
};

export class ProfileSync {
  status: SyncStatus = 'off';
  /** Something the user should know, e.g. they were logged in somewhere else. */
  notice: string | null = null;

  #d: SyncDeps;
  #listeners = new Set<() => void>();
  #debounce: ReturnType<typeof setTimeout> | null = null;
  #inflight: Promise<void> | null = null;
  #again = false;
  #seq = 0;
  #pendingProfile: Profile | null = null;

  constructor(deps: SyncDeps) {
    this.#d = deps;
    if (this.current) this.status = this.pending ? 'waiting' : this.dirty ? 'offline' : 'saved';
  }

  get current(): string | null {
    const v = load<unknown>(K_CURRENT, null);
    return typeof v === 'string' && v ? v : null;
  }

  get pending(): boolean {
    return load<unknown>(K_PENDING, false) === true;
  }

  get dirty(): boolean {
    return typeof load<unknown>(K_DIRTY, null) === 'number';
  }

  /** Called on every status, notice or current-user change. */
  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit() {
    for (const fn of this.#listeners) fn();
  }

  #setStatus(s: SyncStatus) {
    this.status = s;
    this.#emit();
  }

  #now(): number {
    return (this.#d.now ?? Date.now)();
  }

  #token(): string | null {
    const t = load<unknown>('token', null);
    return validToken(t) ? t : null;
  }

  #timerActive(): boolean {
    return load<unknown>('timer', null) !== null;
  }

  // ---- lifecycle ------------------------------------------------------

  /**
   * Before the app mounts: fetch the signed-in profile (short timeout) and, if
   * the server copy is newer than this device's, write it into storage. No
   * reload is needed because no store has read storage yet. On failure the
   * local copy is used.
   */
  async bootstrap(timeoutMs = BOOT_TIMEOUT_MS): Promise<void> {
    const user = this.current;
    const token = this.#token();
    if (!user || !token) return;
    let p: Profile;
    try {
      p = await this.#d.api.get(token, timeoutMs);
    } catch (e) {
      this.#failed(e);
      return;
    }
    if (this.pending) {
      this.#apply(p, false);
      return;
    }
    const dirtyAt = load<unknown>(K_DIRTY, null);
    const syncedAt = load<unknown>(K_SYNCED_AT, 0);
    if (typeof dirtyAt === 'number' && dirtyAt > p.updatedAt) {
      this.#setStatus('offline'); // install() sends it
    } else if (
      typeof dirtyAt === 'number' ||
      typeof syncedAt !== 'number' ||
      p.updatedAt > syncedAt
    ) {
      this.#apply(p, false);
    } else {
      this.#setStatus('saved');
    }
  }

  /** Start watching saves, visibility and connectivity. Returns a stop function. */
  install(): () => void {
    const stops = [
      onSave((key, value) => {
        if (key === 'timer') {
          if (value === null) this.#timerGone();
        } else if (key === 'name' || SYNCED.has(key)) {
          this.#markDirty();
        }
      }),
    ];
    if (typeof window !== 'undefined') {
      const onVisible = () => {
        if (document.visibilityState === 'visible') void this.refresh();
      };
      const onOnline = () => void this.refresh();
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('online', onOnline);
      stops.push(() => {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('online', onOnline);
      });
    }
    if (this.dirty) this.#schedule();
    return () => {
      stops.forEach((s) => s());
      if (this.#debounce) clearTimeout(this.#debounce);
      this.#debounce = null;
    };
  }

  // ---- local -> server ------------------------------------------------

  #markDirty() {
    if (!this.current || this.pending) return;
    saveQuiet(K_DIRTY, this.#now());
    this.#seq++;
    this.#schedule();
  }

  #schedule() {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      this.#debounce = null;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  /** The settings to send: every synced key, with the user's own room-mirrored values. */
  #payload(): Record<string, unknown> {
    const settings = readSynced();
    // While following someone else's timer, drink, background and sounds
    // mirror theirs; the user's own values wait in the `ownSettings` snapshot.
    const own = load<OwnSettings | null>('ownSettings', null);
    if (own && typeof own === 'object') {
      if (typeof own.drinkId === 'string') settings.drink = own.drinkId;
      if (typeof own.backgroundId === 'string') settings.background = own.backgroundId;
      if (typeof own.backgroundRotateMin === 'number') {
        settings.backgroundRotate = own.backgroundRotateMin;
      }
      const sound = settings.sound;
      if (own.mix && typeof own.mix === 'object' && sound && typeof sound === 'object') {
        settings.sound = { ...sound, mix: own.mix };
      }
    }
    return settings;
  }

  #displayName(user: string): string {
    const n = load<unknown>('name', null);
    return typeof n === 'string' && n.trim() ? n : user;
  }

  /** Send unsent changes now. Failures leave them marked for the next try. */
  flush(): Promise<void> {
    if (this.#inflight) {
      this.#again = true;
      return this.#inflight;
    }
    const user = this.current;
    const token = this.#token();
    if (!user || !token || this.pending || !this.dirty) return Promise.resolve();
    if (this.#debounce) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
    const seq = this.#seq;
    const body = { displayName: this.#displayName(user), settings: this.#payload() };
    if (JSON.stringify(body.settings).length > MAX_SETTINGS_BYTES) {
      this.#setStatus('too-big');
      return Promise.resolve();
    }
    this.#setStatus('saving');
    this.#inflight = (async () => {
      try {
        const { updatedAt } = await this.#d.api.put(token, body);
        if (this.current !== user) return;
        saveQuiet(K_SYNCED_AT, updatedAt);
        if (seq === this.#seq) saveQuiet(K_DIRTY, null);
        this.#setStatus('saved');
      } catch (e) {
        this.#failed(e);
      } finally {
        this.#inflight = null;
        if (this.#again) {
          this.#again = false;
          if (this.status !== 'offline') void this.flush();
        }
      }
    })();
    return this.#inflight;
  }

  // ---- server -> local ------------------------------------------------

  /** On becoming visible or online: send what is unsent, else pick up newer changes. */
  async refresh(): Promise<void> {
    const user = this.current;
    const token = this.#token();
    if (!user || !token || this.pending) return;
    if (this.dirty) return this.flush();
    try {
      const p = await this.#d.api.get(token);
      if (this.current !== user || this.dirty) return;
      const syncedAt = load<unknown>(K_SYNCED_AT, 0);
      if (typeof syncedAt !== 'number' || p.updatedAt > syncedAt) this.#apply(p, true);
      else this.#setStatus('saved');
    } catch (e) {
      this.#failed(e);
    }
  }

  /**
   * Make `p` this device's settings. With `reload`, reload so stores re-read
   * them, unless a timer exists: then remember it and apply when the timer
   * goes away (or on the next load). Returns whether it was deferred.
   */
  #apply(p: Profile, reload: boolean): boolean {
    saveQuiet(K_CURRENT, p.username);
    saveQuiet(K_DIRTY, null);
    if (this.#debounce) {
      clearTimeout(this.#debounce);
      this.#debounce = null;
    }
    if (reload && this.#timerActive()) {
      this.#pendingProfile = p;
      saveQuiet(K_PENDING, true);
      this.#setStatus('waiting');
      return true;
    }
    const settings = p.settings && typeof p.settings === 'object' ? p.settings : {};
    writeSynced(settings);
    saveQuiet('name', p.displayName);
    this.#patchOwnSettings(settings);
    saveQuiet(K_SYNCED_AT, p.updatedAt);
    saveQuiet(K_PENDING, false);
    this.#pendingProfile = null;
    this.#setStatus('saved');
    if (reload) this.#d.reload();
    return false;
  }

  /** If following someone's timer, the user's own values live in the snapshot: update it too. */
  #patchOwnSettings(settings: Record<string, unknown>) {
    const own = load<OwnSettings | null>('ownSettings', null);
    if (!own || typeof own !== 'object') return;
    const next = { ...own };
    if (typeof settings.drink === 'string') next.drinkId = settings.drink;
    if (typeof settings.background === 'string') next.backgroundId = settings.background;
    if (typeof settings.backgroundRotate === 'number') {
      next.backgroundRotateMin = settings.backgroundRotate;
    }
    const sound = settings.sound as { mix?: unknown } | undefined;
    if (sound && typeof sound === 'object' && sound.mix && typeof sound.mix === 'object') {
      next.mix = sound.mix;
    }
    saveQuiet('ownSettings', next);
  }

  #timerGone() {
    if (!this.pending) return;
    setTimeout(() => void this.#applyPending(), RELOAD_DELAY_MS);
  }

  async #applyPending() {
    if (!this.pending || this.#timerActive()) return;
    let p = this.#pendingProfile;
    const user = this.current;
    const token = this.#token();
    if (!p || !user || !sameName(p.username, user)) {
      if (!user || !token) return;
      try {
        p = await this.#d.api.get(token);
      } catch (e) {
        this.#failed(e); // stays pending; the next load tries again
        return;
      }
    }
    this.#apply(p, true);
  }

  #failed(e: unknown) {
    if (e instanceof ProfileError && e.status === 401) {
      this.revoked();
      return;
    }
    this.#setStatus('offline');
  }

  #forget() {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = null;
    this.#pendingProfile = null;
    saveQuiet(K_CURRENT, null);
    saveQuiet(K_DIRTY, null);
    saveQuiet(K_PENDING, false);
    saveQuiet(K_SYNCED_AT, null);
    this.status = 'off';
    this.#emit();
  }

  /**
   * The session is gone (logged in elsewhere): drop to logged out, keep the
   * local settings and say why.
   */
  revoked() {
    if (!this.current) return; // already logged out here (e.g. a logout that never reached the server)
    this.#forget();
    this.notice = ELSEWHERE;
    this.#emit();
  }

  // ---- user actions ---------------------------------------------------

  /** Checks shared by logIn and signUp; returns the device token or an error. */
  #precheck(username: string, password: string): { token: string } | { error: string } {
    const error = usernameError(username) ?? passwordError(password);
    if (error) return { error };
    const token = this.#token();
    return token ? { token } : { error: UNREACHABLE };
  }

  /**
   * Log in: the account's settings replace this device's. May reload the page
   * (not while a timer exists).
   */
  async logIn(username: string, password: string): Promise<SignInResult> {
    const pre = this.#precheck(username, password);
    if ('error' in pre) return { ok: false, error: pre.error };
    await this.flush(); // the previous user's unsent changes go to them first
    this.notice = null;
    let p: Profile;
    try {
      p = await this.#d.api.login(pre.token, { username: username.trim(), password });
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
    saveQuiet(K_USED, true);
    const deferred = this.#apply(p, true);
    return { ok: true, deferred, displayName: p.displayName };
  }

  /**
   * Create an account and log in. The first account used on this device starts
   * with its current settings; later ones start fresh (and reload).
   */
  async signUp(username: string, password: string): Promise<SignInResult> {
    const pre = this.#precheck(username, password);
    if ('error' in pre) return { ok: false, error: pre.error };
    const name = username.trim();
    await this.flush();
    this.notice = null;
    const seed = load<unknown>(K_USED, false) !== true;
    let created: Profile;
    try {
      created = await this.#d.api.signup(pre.token, {
        username: name,
        password,
        displayName: name,
        settings: seed ? this.#payload() : {},
      });
    } catch (e) {
      return { ok: false, error: errorText(e) };
    }
    saveQuiet(K_USED, true);
    if (seed) {
      // This device's settings are the account's already: no reload needed.
      saveQuiet(K_CURRENT, created.username);
      saveQuiet(K_SYNCED_AT, created.updatedAt);
      saveQuiet(K_DIRTY, null);
      saveQuiet(K_PENDING, false);
      saveQuiet('name', created.displayName);
      this.#setStatus('saved');
      return { ok: true, deferred: false, displayName: created.displayName };
    }
    const deferred = this.#apply(created, true);
    return { ok: true, deferred, displayName: created.displayName };
  }

  /** Log out. Local settings stay; the server is told on a best-effort basis. */
  async logOut(): Promise<void> {
    const token = this.#token();
    if (token && this.current) {
      await this.flush(); // unsent changes go to the account while the session lives
      try {
        await this.#d.api.logout(token);
      } catch {
        // unreachable: the server's session lapses on its own
      }
    }
    this.notice = null;
    this.#forget();
  }

  /** Delete the logged-in account. Returns an error message, or null (logged out). */
  async deleteAccount(password: string): Promise<string | null> {
    const token = this.#token();
    if (!token) return UNREACHABLE;
    try {
      await this.#d.api.remove(token, password);
    } catch (e) {
      if (e instanceof ProfileError && e.status === 401 && /signed in/i.test(e.message)) {
        this.revoked();
        return ELSEWHERE;
      }
      return errorText(e);
    }
    this.notice = null;
    this.#forget();
    return null;
  }

  /** Change the logged-in account's password. Returns an error message, or null. */
  async changePassword(current: string, next: string): Promise<string | null> {
    if (!current) return 'Enter your current password.';
    const invalid = passwordError(next);
    if (invalid) return invalid;
    const token = this.#token();
    if (!token) return UNREACHABLE;
    try {
      await this.#d.api.changePassword(token, { current, new: next });
    } catch (e) {
      if (e instanceof ProfileError && e.status === 401 && /signed in/i.test(e.message)) {
        this.revoked();
        return ELSEWHERE;
      }
      return errorText(e);
    }
    return null;
  }
}

export const profileSync = new ProfileSync({
  api: realApi,
  reload: () => location.reload(),
});
