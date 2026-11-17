import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, save } from '../storage';
import { ProfileError, type Profile, type ProfilesApi } from './api';
import { DEBOUNCE_MS, ProfileSync, usernameError } from './sync';

const TOKEN = '0123456789abcdef0123456789abcdef';

function fakeApi() {
  const db = new Map<string, Profile>();
  let clock = 1000;
  const api = {
    list: vi.fn(async () =>
      [...db.values()].map((p) => ({ username: p.username, displayName: p.displayName })),
    ),
    get: vi.fn(async (_t: string, username: string) => {
      const p = db.get(username.toLowerCase());
      if (!p) throw new ProfileError(404, 'no such profile');
      return structuredClone(p);
    }),
    create: vi.fn(
      async (
        _t: string,
        body: { username: string; displayName: string; settings: Record<string, unknown> },
      ) => {
        if (db.has(body.username.toLowerCase()))
          throw new ProfileError(409, 'that username is taken');
        const p = { ...structuredClone(body), updatedAt: ++clock };
        db.set(body.username.toLowerCase(), p);
        return structuredClone(p);
      },
    ),
    put: vi.fn(
      async (
        _t: string,
        username: string,
        body: { displayName: string; settings: Record<string, unknown> },
      ) => {
        const p = db.get(username.toLowerCase());
        if (!p) throw new ProfileError(404, 'no such profile');
        Object.assign(p, structuredClone(body), { updatedAt: ++clock });
        return { updatedAt: p.updatedAt };
      },
    ),
    remove: vi.fn(async (_t: string, username: string) => {
      if (!db.delete(username.toLowerCase())) throw new ProfileError(404, 'no such profile');
    }),
  } satisfies ProfilesApi;
  return { api, db };
}

const offline = () => Promise.reject(new TypeError('Failed to fetch'));

describe('ProfileSync', () => {
  let stops: (() => void)[] = [];
  let reload: ReturnType<typeof vi.fn<() => void>>;

  function make(api: ProfilesApi, now = () => 5000) {
    const sync = new ProfileSync({ api, reload, now });
    stops.push(sync.install());
    return sync;
  }

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    reload = vi.fn<() => void>();
    save('token', TOKEN);
  });
  afterEach(() => {
    stops.forEach((s) => s());
    stops = [];
    vi.useRealTimers();
  });

  it('validates usernames', () => {
    expect(usernameError('  ')).toBe('Enter a username.');
    expect(usernameError('x'.repeat(25))).toMatch(/24/);
    expect(usernameError('a\u0001b')).not.toBeNull();
    expect(usernameError(' Ada ')).toBeNull();
  });

  it('sends nothing while signed out', async () => {
    const { api } = fakeApi();
    make(api);
    save('drink', 'latte');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(api.put).not.toHaveBeenCalled();
  });

  it('first user on a device starts with its settings and does not reload', async () => {
    const { api, db } = fakeApi();
    save('drink', 'matcha');
    save('todos', [{ id: 'a', text: 'Read', done: false }]);
    save('notes', [{ id: 'n' }]);
    save('name', 'Mocha Otter');
    const sync = make(api);
    const r = await sync.signIn(' Ada ');
    expect(r).toEqual({ ok: true, deferred: false, displayName: 'Ada' });
    expect(reload).not.toHaveBeenCalled();
    expect(sync.current).toBe('Ada');
    const stored = db.get('ada')!;
    expect(stored.displayName).toBe('Ada');
    expect(stored.settings).toEqual({
      drink: 'matcha',
      todos: [{ id: 'a', text: 'Read', done: false }],
    });
    expect(load('name', '')).toBe('Ada');
  });

  it('later new users start fresh: synced keys are cleared and the page reloads', async () => {
    const { api, db } = fakeApi();
    save('drink', 'matcha');
    save('notify', true);
    const sync = make(api);
    await sync.signIn('Ada');
    const r = await sync.signIn('Bea');
    expect(r).toMatchObject({ ok: true, deferred: false });
    expect(db.get('bea')!.settings).toEqual({});
    expect(load('drink', null)).toBeNull();
    expect(load('notify', null)).toBe(true); // device-only, untouched
    expect(load('name', '')).toBe('Bea');
    expect(sync.current).toBe('Bea');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('signing in as an existing user (any case) replaces device settings and reloads', async () => {
    const { api, db } = fakeApi();
    db.set('ada', {
      username: 'Ada',
      displayName: 'Ada L',
      settings: { drink: 'chai', clockShow: true },
      updatedAt: 50,
    });
    save('drink', 'matcha');
    save('background', 'rain');
    save('timer', null);
    const sync = make(api);
    expect(await sync.signIn('ADA')).toMatchObject({ ok: true, deferred: false });
    expect(sync.current).toBe('Ada');
    expect(load('drink', null)).toBe('chai');
    expect(load('background', null)).toBeNull();
    expect(load('clockShow', null)).toBe(true);
    expect(load('name', '')).toBe('Ada L');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('never reloads while a timer exists; applies when the timer goes away', async () => {
    const { api, db } = fakeApi();
    db.set('ada', {
      username: 'Ada',
      displayName: 'Ada',
      settings: { drink: 'chai' },
      updatedAt: 50,
    });
    save('drink', 'matcha');
    save('timer', { focusMs: 60000, breakMs: 300000, rounds: 1, elapsedMs: 0, anchorAt: 1 });
    const sync = make(api);
    expect(await sync.signIn('Ada')).toMatchObject({ ok: true, deferred: true });
    expect(reload).not.toHaveBeenCalled();
    expect(load('drink', null)).toBe('matcha');
    expect(sync.status).toBe('waiting');

    // Changes made meanwhile belong to the old settings: not sent to Ada.
    save('drink', 'mocha');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(api.put).not.toHaveBeenCalled();

    save('timer', null);
    await vi.advanceTimersByTimeAsync(1000);
    expect(load('drink', null)).toBe('chai');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('debounces synced saves into one PUT and never sends device-only keys', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signIn('Ada');
    api.put.mockClear();

    save('token', TOKEN);
    save('notify', true);
    save('notes', []);
    save('ownSettings', null);
    save('profile', 'Ada');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(api.put).not.toHaveBeenCalled();

    save('drink', 'latte');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
    save('todos', []);
    save('name', 'Ada L');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(api.put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.put).toHaveBeenCalledTimes(1);
    const [, user, body] = api.put.mock.calls[0];
    expect(user).toBe('Ada');
    expect(body.displayName).toBe('Ada L');
    expect(Object.keys(body.settings).sort()).toEqual(['drink', 'todos']);
    expect(sync.dirty).toBe(false);
    expect(sync.status).toBe('saved');
  });

  it('keeps failed changes and retries on the next change and when visible', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signIn('Ada');
    const realPut = api.put.getMockImplementation()!;
    api.put.mockImplementation(offline);

    save('drink', 'latte');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(sync.dirty).toBe(true);
    expect(sync.status).toBe('offline');

    save('drink', 'chai');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(api.put).toHaveBeenCalledTimes(2);

    api.put.mockImplementation(realPut);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.put).toHaveBeenCalledTimes(3);
    expect(api.put.mock.calls[2][2].settings.drink).toBe('chai');
    expect(sync.dirty).toBe(false);
  });

  it("sends the user's own drink, background and mix while following someone", async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signIn('Ada');
    save('ownSettings', {
      drinkId: 'mine',
      backgroundId: 'rain',
      backgroundRotateMin: 5,
      mix: { rain: 1 },
    });
    save('drink', 'theirs');
    save('sound', { mix: { fire: 1 }, levels: {}, master: 0.5, muted: false, enabled: true });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const settings = api.put.mock.calls.at(-1)![2].settings;
    expect(settings.drink).toBe('mine');
    expect(settings.background).toBe('rain');
    expect(settings.backgroundRotate).toBe(5);
    expect(settings.sound).toMatchObject({ mix: { rain: 1 }, master: 0.5 });
    expect(sync.current).toBe('Ada');
  });

  it('bootstrap applies a newer server copy without reloading', async () => {
    const { api, db } = fakeApi();
    db.set('ada', {
      username: 'Ada',
      displayName: 'Ada',
      settings: { drink: 'chai' },
      updatedAt: 90,
    });
    save('profile', 'Ada');
    save('profileSyncedAt', 10);
    save('drink', 'matcha');
    const sync = new ProfileSync({ api, reload, now: () => 5 });
    await sync.bootstrap();
    expect(load('drink', null)).toBe('chai');
    expect(reload).not.toHaveBeenCalled();
  });

  it('bootstrap keeps newer unsent local changes and sends them', async () => {
    const { api, db } = fakeApi();
    db.set('ada', {
      username: 'Ada',
      displayName: 'Ada',
      settings: { drink: 'chai' },
      updatedAt: 90,
    });
    save('profile', 'Ada');
    save('profileSyncedAt', 10);
    save('profileDirty', 100);
    save('drink', 'matcha');
    const sync = new ProfileSync({ api, reload });
    await sync.bootstrap();
    expect(load('drink', null)).toBe('matcha');
    stops.push(sync.install());
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(db.get('ada')!.settings).toEqual({ drink: 'matcha' });
  });

  it('bootstrap falls back to the local copy when the server is unreachable', async () => {
    const api = { ...fakeApi().api, get: vi.fn(offline) };
    save('profile', 'Ada');
    save('drink', 'matcha');
    const sync = new ProfileSync({ api, reload });
    await sync.bootstrap();
    expect(load('drink', null)).toBe('matcha');
    expect(sync.current).toBe('Ada');
    expect(sync.status).toBe('offline');
  });

  it('reports a name taken in a create race', async () => {
    const { api } = fakeApi();
    api.create.mockRejectedValueOnce(new ProfileError(409, 'that username is taken'));
    const sync = make(api);
    const r = await sync.signIn('Ada');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/taken/);
    expect(sync.current).toBeNull();
  });

  it('deleting the signed-in user signs this device out and keeps its settings', async () => {
    const { api, db } = fakeApi();
    const sync = make(api);
    save('drink', 'matcha');
    await sync.signIn('Ada');
    expect(await sync.remove('ada')).toBeNull();
    expect(db.size).toBe(0);
    expect(sync.current).toBeNull();
    expect(load('drink', null)).toBe('matcha');
    save('drink', 'chai');
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(api.put).not.toHaveBeenCalled();
  });
});
