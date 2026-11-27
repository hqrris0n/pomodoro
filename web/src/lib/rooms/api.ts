import type { Settings, SettingsPatch, TimerState } from '../types';

export type Role = 'host' | 'cohost' | 'guest';
export type Member = {
  id: string;
  name: string;
  role: Role;
  joinedAt: number;
  /** Epoch ms of the current promotion; co-hosts only. */
  promotedAt?: number | null;
};
/** `timer` is null while the host is choosing the next order; `timerRev` grows with every timer change. */
export type Room = {
  id: string;
  settings: Settings;
  timer: TimerState | null;
  timerRev?: number;
  members: Member[];
};
/** A room someone can follow: one with a timer. */
export type RoomSummary = {
  id: string;
  ownerName: string;
  memberCount: number;
  drinkId: string;
  timer: TimerState;
};
/** An entry of the `rooms` event, which also lists rooms between timers. */
export type ListedRoom = Omit<RoomSummary, 'timer'> & { timer: TimerState | null };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
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
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

const id = encodeURIComponent;

export function createRoom(
  token: string,
  body: { name: string; settings: Settings; timer: TimerState },
): Promise<Room> {
  return call(token, 'POST', '/rooms', body);
}

export function joinRoom(token: string, roomId: string, body: { name: string }): Promise<Room> {
  return call(token, 'POST', `/rooms/${id(roomId)}/join`, body);
}

export function leaveRoom(token: string, roomId: string): Promise<Record<string, never>> {
  return call(token, 'POST', `/rooms/${id(roomId)}/leave`);
}

export function patchRoom(
  token: string,
  roomId: string,
  body: { settings?: SettingsPatch; timer?: TimerState | null },
): Promise<Room> {
  return call(token, 'PATCH', `/rooms/${id(roomId)}`, body);
}

export function setRole(
  token: string,
  roomId: string,
  memberId: string,
  role: 'cohost' | 'guest',
): Promise<Room> {
  return call(token, 'POST', `/rooms/${id(roomId)}/role`, { memberId, role });
}

export function rename(token: string, name: string): Promise<Record<string, never>> {
  return call(token, 'PUT', '/me', { name });
}

export function sendNote(
  token: string,
  roomId: string,
  body: { to: string; text: string },
): Promise<{ id: string }> {
  return call(token, 'POST', `/rooms/${id(roomId)}/notes`, body);
}

export type RoomsApi = {
  createRoom: typeof createRoom;
  joinRoom: typeof joinRoom;
  leaveRoom: typeof leaveRoom;
  patchRoom: typeof patchRoom;
  setRole: typeof setRole;
  rename: typeof rename;
  sendNote: typeof sendNote;
};
