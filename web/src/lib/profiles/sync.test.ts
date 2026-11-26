import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load, save } from '../storage';
import { ProfileError, type Profile, type ProfilesApi, type Settings } from './api';
import { DEBOUNCE_MS, passwordError, ProfileSync, usernameError } from './sync';

const TOKEN = '0123456789abcdef0123456789abcdef';

type Account = Profile & { password: string };

/** An in-memory account server: one session (the latest login), like the real one. */
function fakeApi() {
  const db = new Map<string, Account>();
  let clock = 1000;
  let session: string | null = null;
  const signedIn = () => {
    const p = session ? db.get(session) : undefined;
    if (!p) throw new ProfileError(401, 'Not signed in.');
    return p;
  };
  const api = {
    signup: vi.fn(
      async (
        _t: string,
        body: { username: string; password: string; displayName: string; settings: Settings },
      ) => {
        const key = body.username.toLowerCase();
        if (db.has(key)) throw new ProfileError(409, 'That username is taken.');
        const { password, ...rest } = structuredClone(body);
        const p = { ...rest, password, updatedAt: ++clock };
        db.set(key, p);
        session = key;
        return profileOf(p);
      },
    ),
    login: vi.fn(async (_t: string, body: { username: string; password: string }) => {
      const p = db.get(body.username.toLowerCase());
      if (!p || p.password !== body.password) {
        throw new ProfileError(401, 'Wrong username or password.');
      }
      session = body.username.toLowerCase();
      return profileOf(p);
    }),
    logout: vi.fn(async () => {
      session = null;
    }),
    get: vi.fn(async () => profileOf(signedIn())),
    put: vi.fn(async (_t: string, body: { displayName: string; settings: Settings }) => {
      const p = signedIn();
      Object.assign(p, structuredClone(body), { updatedAt: ++clock });
      return { updatedAt: p.updatedAt };
    }),
    remove: vi.fn(async (_t: string, password: string) => {
      const p = signedIn();
      if (p.password !== password) throw new ProfileError(401, 'Wrong password.');
      db.delete(session!);
      session = null;
    }),
    changePassword: vi.fn(async (_t: string, body: { current: string; new: string }) => {
      const p = signedIn();
      if (p.password !== body.current) throw new ProfileError(401, 'Wrong password.');
      p.password = body.new;
    }),
  } satisfies ProfilesApi;
  /** Another device logs in: this one's session dies. */
  const revokeSession = () => {
    session = null;
  };
  const startSession = (username: string) => {
    session = username.toLowerCase();
  };
  return { api, db, revokeSession, startSession };
}

function profileOf(a: Account): Profile {
  const p: Partial<Account> = structuredClone(a);
  delete p.password;
  return p as Profile;
}

const PW = 'hunter22';
const account = (over: Partial<Account> = {}): Account => ({
  username: 'ada',
  displayName: 'Ada',
  password: PW,
  settings: {},
  updatedAt: 50,
  ...over,
});

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

  it('validates passwords by length in characters', () => {
    expect(passwordError('1234567')).toBe('Password must be at least 8 characters.');
    expect(passwordError('12345678')).toBeNull();
    expect(passwordError('😀'.repeat(72))).toBeNull();
    expect(passwordError('x'.repeat(73))).toBe('Password must be at most 72 characters.');
  });

  it("logs in with the device token and the account's settings replace this device's", async () => {
    const { api, db } = fakeApi();
    db.set('ada', account({ username: 'Ada', displayName: 'Ada L', settings: { drink: 'chai' } }));
    save('drink', 'matcha');
    save('background', 'rain');
    const sync = make(api);
    expect(await sync.logIn(' ada ', PW)).toEqual({
      ok: true,
      deferred: false,
      displayName: 'Ada L',
    });
    expect(api.login).toHaveBeenCalledExactlyOnceWith(TOKEN, { username: 'ada', password: PW });
    expect(sync.current).toBe('Ada');
    expect(load('drink', null)).toBe('chai');
    expect(load('background', null)).toBeNull();
    expect(load('name', '')).toBe('Ada L');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a wrong password leaves the device logged out', async () => {
    const { api, db } = fakeApi();
    db.set('ada', account());
    const sync = make(api);
    expect(await sync.logIn('ada', 'wrong-pass')).toEqual({
      ok: false,
      error: 'Wrong username or password.',
    });
    expect(sync.current).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('never reloads while a timer exists; applies when the timer goes away', async () => {
    const { api, db } = fakeApi();
    db.set('ada', account({ username: 'Ada', settings: { drink: 'chai' } }));
    save('drink', 'matcha');
    save('timer', { focusMs: 60000, breakMs: 300000, rounds: 1, elapsedMs: 0, anchorAt: 1 });
    const sync = make(api);
    expect(await sync.logIn('Ada', PW)).toMatchObject({ ok: true, deferred: true });
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

  it('the first account on a device starts with its settings and does not reload', async () => {
    const { api, db } = fakeApi();
    save('drink', 'matcha');
    save('todos', [{ id: 'a', text: 'Read', done: false }]);
    save('notes', [{ id: 'n' }]);
    save('name', 'Mocha Otter');
    const sync = make(api);
    expect(await sync.signUp(' Ada ', PW)).toEqual({
      ok: true,
      deferred: false,
      displayName: 'Ada',
    });
    expect(api.signup).toHaveBeenCalledExactlyOnceWith(TOKEN, {
      username: 'Ada',
      password: PW,
      displayName: 'Ada',
      settings: { drink: 'matcha', todos: [{ id: 'a', text: 'Read', done: false }] },
    });
    expect(reload).not.toHaveBeenCalled();
    expect(sync.current).toBe('Ada');
    expect(db.get('ada')!.settings).toEqual({
      drink: 'matcha',
      todos: [{ id: 'a', text: 'Read', done: false }],
    });
    expect(load('name', '')).toBe('Ada');
  });

  it('later accounts start fresh: synced keys are cleared and the page reloads', async () => {
    const { api, db } = fakeApi();
    save('drink', 'matcha');
    save('notify', true);
    const sync = make(api);
    await sync.signUp('Ada', PW);
    await sync.logOut();
    expect(await sync.signUp('Bea', PW)).toMatchObject({ ok: true, deferred: false });
    expect(db.get('bea')!.settings).toEqual({});
    expect(load('drink', null)).toBeNull();
    expect(load('notify', null)).toBe(true); // device-only, untouched
    expect(sync.current).toBe('Bea');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a taken username stays logged out with the server message', async () => {
    const { api, db } = fakeApi();
    db.set('ada', account());
    const sync = make(api);
    expect(await sync.signUp('Ada', PW)).toEqual({ ok: false, error: 'That username is taken.' });
    expect(sync.current).toBeNull();
  });

  it('rejects a bad username or password without a request', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    expect(await sync.signUp('Ada', 'short')).toEqual({
      ok: false,
      error: 'Password must be at least 8 characters.',
    });
    expect(await sync.logIn('Ada', 'short')).toMatchObject({ ok: false });
    expect(await sync.logIn('  ', PW)).toEqual({ ok: false, error: 'Enter a username.' });
    expect(api.signup).not.toHaveBeenCalled();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('shows server messages in sentence case, and unreachable or unavailable servers plainly', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    api.login.mockRejectedValueOnce(new ProfileError(429, 'too many requests'));
    expect(await sync.logIn('Ada', PW)).toEqual({ ok: false, error: 'Too many requests' });
    api.login.mockRejectedValueOnce(new ProfileError(503, 'profiles are unavailable'));
    expect(await sync.logIn('Ada', PW)).toEqual({
      ok: false,
      error: 'Accounts are unavailable on this server right now.',
    });
    api.login.mockImplementationOnce(offline);
    expect(await sync.logIn('Ada', PW)).toEqual({
      ok: false,
      error: "Can't reach the café right now.",
    });
  });

  it('debounces synced saves into one PUT and never sends device-only keys', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signUp('Ada', PW);
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
    const [, body] = api.put.mock.calls[0];
    expect(body.displayName).toBe('Ada L');
    expect(Object.keys(body.settings).sort()).toEqual(['drink', 'todos']);
    expect(sync.dirty).toBe(false);
    expect(sync.status).toBe('saved');
  });

  it('keeps failed changes and retries on the next change and when visible', async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signUp('Ada', PW);
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
    expect(api.put.mock.calls[2][1].settings.drink).toBe('chai');
    expect(sync.dirty).toBe(false);
  });

  it("sends the user's own drink, background and mix while following someone", async () => {
    const { api } = fakeApi();
    const sync = make(api);
    await sync.signUp('Ada', PW);
    save('ownSettings', {
      drinkId: 'mine',
      backgroundId: 'rain',
      backgroundRotateMin: 5,
      mix: { rain: 1 },
    });
    save('drink', 'theirs');
    save('sound', { mix: { fire: 1 }, levels: {}, master: 0.5, muted: false, enabled: true });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const settings = api.put.mock.calls.at(-1)![1].settings;
    expect(settings.drink).toBe('mine');
    expect(settings.background).toBe('rain');
    expect(settings.backgroundRotate).toBe(5);
    expect(settings.sound).toMatchObject({ mix: { rain: 1 }, master: 0.5 });
    expect(sync.current).toBe('Ada');
  });

  it('bootstrap applies a newer server copy without reloading', async () => {
    const { api, db, startSession } = fakeApi();
    db.set('ada', account({ username: 'Ada', settings: { drink: 'chai' }, updatedAt: 90 }));
    startSession('ada');
    save('profile', 'Ada');
    save('profileSyncedAt', 10);
    save('drink', 'matcha');
    const sync = new ProfileSync({ api, reload, now: () => 5 });
    await sync.bootstrap();
    expect(api.get).toHaveBeenCalledWith(TOKEN, expect.any(Number));
    expect(load('drink', null)).toBe('chai');
    expect(reload).not.toHaveBeenCalled();
  });

  it('bootstrap keeps newer unsent local changes and sends them', async () => {
    const { api, db, startSession } = fakeApi();
    db.set('ada', account({ username: 'Ada', settings: { drink: 'chai' }, updatedAt: 90 }));
    startSession('ada');
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

  describe('a session that ended elsewhere', () => {
    const ELSEWHERE = 'You were logged in somewhere else.';

    async function loggedIn() {
      const f = fakeApi();
      const sync = make(f.api);
      save('drink', 'matcha');
      await sync.signUp('Ada', PW);
      return { ...f, sync };
    }

    function expectDroppedKeepingSettings(sync: ProfileSync) {
      expect(sync.current).toBeNull();
      expect(sync.status).toBe('off');
      expect(sync.notice).toBe(ELSEWHERE);
      expect(load('drink', null)).toBe('matcha');
      expect(load('profile', null)).toBeNull();
      expect(load('profileDirty', null)).toBeNull();
    }

    it('drops to logged out when a background save gets 401', async () => {
      const { sync, revokeSession, api } = await loggedIn();
      revokeSession();
      save('drink', 'latte');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      expect(api.put).toHaveBeenCalled();
      expect(sync.notice).toBe(ELSEWHERE);
      expect(load('drink', null)).toBe('latte');
      expect(sync.current).toBeNull();
    });

    it('drops to logged out when a refresh gets 401', async () => {
      const { sync, revokeSession } = await loggedIn();
      revokeSession();
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expectDroppedKeepingSettings(sync);
    });

    it('drops to logged out when bootstrap gets 401', async () => {
      const { api, revokeSession } = await loggedIn();
      revokeSession();
      const sync = new ProfileSync({ api, reload });
      await sync.bootstrap();
      expectDroppedKeepingSettings(sync);
    });

    it('does the same on revoked(), and stops sending changes', async () => {
      const { sync, api } = await loggedIn();
      sync.revoked();
      expectDroppedKeepingSettings(sync);
      api.put.mockClear();
      save('drink', 'matcha');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('a later login clears the note', async () => {
      const { sync, db } = await loggedIn();
      sync.revoked();
      db.get('ada')!.settings = { drink: 'chai' };
      await sync.logIn('Ada', PW);
      expect(sync.notice).toBeNull();
    });
  });

  describe('logging out and deleting', () => {
    it('logs out through the endpoint and keeps local settings', async () => {
      const { api } = fakeApi();
      const sync = make(api);
      save('drink', 'matcha');
      await sync.signUp('Ada', PW);
      await sync.logOut();
      expect(api.logout).toHaveBeenCalledExactlyOnceWith(TOKEN);
      expect(sync.current).toBeNull();
      expect(sync.notice).toBeNull();
      expect(load('drink', null)).toBe('matcha');
      api.put.mockClear();
      save('drink', 'chai');
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
      expect(api.put).not.toHaveBeenCalled();
    });

    it('logs out locally even when the server cannot be reached', async () => {
      const { api } = fakeApi();
      const sync = make(api);
      await sync.signUp('Ada', PW);
      api.logout.mockImplementationOnce(offline);
      await sync.logOut();
      expect(sync.current).toBeNull();
      expect(sync.status).toBe('off');
    });

    it('a wrong password keeps the account; the right one logs out', async () => {
      const { api, db } = fakeApi();
      const sync = make(api);
      save('drink', 'matcha');
      await sync.signUp('Ada', PW);
      expect(await sync.deleteAccount('wrong-pass')).toBe('Wrong password.');
      expect(sync.current).toBe('Ada');
      expect(db.size).toBe(1);
      expect(await sync.deleteAccount(PW)).toBeNull();
      expect(db.size).toBe(0);
      expect(sync.current).toBeNull();
      expect(load('drink', null)).toBe('matcha');
    });
  });

  describe('changing the password', () => {
    it('checks the boxes locally and sends nothing when they fail', async () => {
      const { api } = fakeApi();
      const sync = make(api);
      await sync.signUp('Ada', PW);
      expect(await sync.changePassword(PW, '1234567')).toBe(
        'Password must be at least 8 characters.',
      );
      expect(await sync.changePassword('', 'newpass99')).toBe('Enter your current password.');
      expect(api.changePassword).not.toHaveBeenCalled();
    });

    it('a wrong current password changes nothing; the right one changes it and stays logged in', async () => {
      const { api, db } = fakeApi();
      const sync = make(api);
      await sync.signUp('Ada', PW);
      expect(await sync.changePassword('wrong-pass', 'newpass99')).toBe('Wrong password.');
      expect(db.get('ada')!.password).toBe(PW);
      expect(await sync.changePassword(PW, 'newpass99')).toBeNull();
      expect(api.changePassword).toHaveBeenLastCalledWith(TOKEN, {
        current: PW,
        new: 'newpass99',
      });
      expect(db.get('ada')!.password).toBe('newpass99');
      expect(sync.current).toBe('Ada');
    });

    it('logs out locally with a notice when the session is gone', async () => {
      const { api, revokeSession } = fakeApi();
      const sync = make(api);
      await sync.signUp('Ada', PW);
      revokeSession();
      expect(await sync.changePassword(PW, 'newpass99')).toBe('You were logged in somewhere else.');
      expect(sync.current).toBeNull();
      expect(sync.notice).toBe('You were logged in somewhere else.');
    });

    it('sends PUT /api/account/password with {current, new}', async () => {
      const fetchMock = vi.fn(async () => new Response('{}'));
      vi.stubGlobal('fetch', fetchMock);
      const { realApi } = await import('./api');
      await realApi.changePassword(TOKEN, { current: PW, new: 'newpass99' });
      const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
      expect(url).toBe('/api/account/password');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body as string)).toEqual({ current: PW, new: 'newpass99' });
      vi.unstubAllGlobals();
    });
  });

  it('never talks to /api/profiles', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ username: 'Ada', displayName: 'Ada', settings: {}, updatedAt: 1 }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { realApi } = await import('./api');
    const sync = make(realApi);
    await sync.logIn('Ada', PW);
    await sync.logOut();
    await sync.deleteAccount(PW);
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.length).toBeGreaterThan(0);
    for (const [url, init] of calls) {
      expect(url).not.toMatch(/\/api\/profiles/);
      expect(init.credentials).toBe('same-origin');
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
    vi.unstubAllGlobals();
  });
});
