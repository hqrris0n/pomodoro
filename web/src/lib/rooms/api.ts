import type { Settings, TimerState } from '../types';

export type Member = { id: string; name: string; role: 'owner' | 'visitor'; joinedAt: number };
export type Room = { id: string; settings: Settings; timer: TimerState; members: Member[] };
export type RoomSummary = {
  id: string;
  ownerName: string;
  memberCount: number;
  drinkId: string;
  timer: TimerState;
};

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
  body: { settings?: Settings; timer?: TimerState },
): Promise<Room> {
  return call(token, 'PATCH', `/rooms/${id(roomId)}`, body);
}

export function promote(token: string, roomId: string, memberId: string): Promise<Room> {
  return call(token, 'POST', `/rooms/${id(roomId)}/promote`, { memberId });
}

export function rename(token: string, name: string): Promise<Record<string, never>> {
  return call(token, 'PUT', '/me', { name });
}

export type RoomsApi = {
  createRoom: typeof createRoom;
  joinRoom: typeof joinRoom;
  leaveRoom: typeof leaveRoom;
  patchRoom: typeof patchRoom;
  promote: typeof promote;
  rename: typeof rename;
};
