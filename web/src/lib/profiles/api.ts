// HTTP client for the account routes: /api/auth/* and /api/account.

export type Profile = {
  username: string;
  displayName: string;
  settings: Record<string, unknown>;
  updatedAt: number;
};

/** The server answered with an error status. */
export class ProfileError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.status = status;
  }
}

export type Settings = Record<string, unknown>;
export type Credentials = { username: string; password: string };

export type ProfilesApi = {
  signup(
    token: string,
    body: Credentials & { displayName: string; settings: Settings },
  ): Promise<Profile>;
  login(token: string, body: Credentials): Promise<Profile>;
  logout(token: string): Promise<void>;
  get(token: string, timeoutMs?: number): Promise<Profile>;
  put(
    token: string,
    body: { displayName: string; settings: Settings },
  ): Promise<{ updatedAt: number }>;
  remove(token: string, password: string): Promise<void>;
  changePassword(token: string, body: { current: string; new: string }): Promise<void>;
};

const TIMEOUT_MS = 8000;

async function call<T>(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // empty or non-JSON body
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ProfileError(res.status, msg);
  }
  return data as T;
}

export const realApi: ProfilesApi = {
  signup: (token, body) => call(token, 'POST', '/api/auth/signup', body),
  login: (token, body) => call(token, 'POST', '/api/auth/login', body),
  async logout(token) {
    await call(token, 'POST', '/api/auth/logout');
  },
  get: (token, timeoutMs) => call(token, 'GET', '/api/account', undefined, timeoutMs),
  put: (token, body) => call(token, 'PUT', '/api/account', body),
  async remove(token, password) {
    await call(token, 'DELETE', '/api/account', { password });
  },
  async changePassword(token, body) {
    await call(token, 'PUT', '/api/account/password', body);
  },
};
