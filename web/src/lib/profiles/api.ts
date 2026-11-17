// HTTP client for /api/profiles (docs/protocol.md, "Profiles").

export type Profile = {
  username: string;
  displayName: string;
  settings: Record<string, unknown>;
  updatedAt: number;
};
export type ProfileSummary = { username: string; displayName: string };

/** The server answered with an error status. */
export class ProfileError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ProfileError';
    this.status = status;
  }
}

export type ProfilesApi = {
  list(token: string): Promise<ProfileSummary[]>;
  get(token: string, username: string, timeoutMs?: number): Promise<Profile>;
  create(
    token: string,
    body: { username: string; displayName: string; settings: Record<string, unknown> },
  ): Promise<Profile>;
  put(
    token: string,
    username: string,
    body: { displayName: string; settings: Record<string, unknown> },
  ): Promise<{ updatedAt: number }>;
  remove(token: string, username: string): Promise<void>;
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
  const res = await fetch(`/api/profiles${path}`, {
    method,
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

const seg = (username: string) => `/${encodeURIComponent(username)}`;

export const realApi: ProfilesApi = {
  async list(token) {
    const data = await call<{ profiles?: unknown }>(token, 'GET', '');
    return Array.isArray(data?.profiles) ? (data.profiles as ProfileSummary[]) : [];
  },
  get: (token, username, timeoutMs) => call(token, 'GET', seg(username), undefined, timeoutMs),
  create: (token, body) => call(token, 'POST', '', body),
  put: (token, username, body) => call(token, 'PUT', seg(username), body),
  async remove(token, username) {
    await call(token, 'DELETE', seg(username));
  },
};
