# Room protocol

The app is local-first: a timer runs entirely in the browser and keeps working
if the server is unreachable. The server only lets people see and join each
other's timers. It keeps everything in memory; a restart empties it and
clients re-create their rooms.

Transport: JSON over HTTP `POST`/`PATCH` for commands, one Server-Sent Events
stream per client for updates. Go standard library only.

## Identity

Each browser generates a random secret `token` (32 hex chars) once and stores
it. The server never shows a token to anyone else; a member's public `id` is
the first 12 hex chars of `sha256(token)`. Commands carry the token in the
`Authorization: Bearer <token>` header. The SSE stream carries it as
`?token=` because `EventSource` cannot set headers.

## Timer state

The timer is a pure function of elapsed time, so the server never ticks.

```ts
type TimerState = {
  focusMs: number;   // 60_000 .. 10_800_000, whole minutes
  breakMs: number;   // 300_000 | 600_000 | 900_000 (ignored when rounds = 1)
  rounds: number;    // 1 .. 6
  elapsedMs: number; // elapsed at the moment of `anchorAt` (or while paused)
  anchorAt: number | null; // server epoch ms when it last started running; null = paused
};
```

`elapsed(now) = elapsedMs + (anchorAt === null ? 0 : now - anchorAt)`.
The schedule is focus, break, focus, … ending on a focus (no break after the
last round). Total = `rounds * focusMs + (rounds - 1) * breakMs`. Phase,
round and remaining time are derived from `elapsed`; `elapsed >= total` means
done. Every server message carries `now` (server epoch ms) so clients can
correct for clock skew.

## Room state

```ts
type Settings = {
  drinkId: string;                 // <= 32 chars
  backgroundId: string;            // <= 32 chars
  backgroundRotateMin: number;     // 0 = off, else 1 .. 120
  mix: Record<string, number>;     // channel id -> volume 0..1, <= 16 keys
};
type Member = { id: string; name: string; role: 'host' | 'cohost' | 'guest'; joinedAt: number };
type Room = { id: string; settings: Settings; timer: TimerState; members: Member[] };
type RoomSummary = {
  id: string; ownerName: string; memberCount: number; drinkId: string; timer: TimerState;
};
```

Roles: the **host** is whoever started the timer, a **co-host** can control
the timer and settings like the host, and a **guest** is read-only. A room has
exactly one host at all times. Only the host changes other members between
co-host and guest. New joiners are guests.

A client is in at most one room. Master volume, mute and todos are never sent.
A client whose "show my timer to others" setting is off does not create a
room at all.

## Endpoints (all under `/api`)

| Method and path               | Who     | Body                              | Effect |
| ----------------------------- | ------- | --------------------------------- | ------ |
| `GET /events?token=&name=`    | anyone  | —                                 | SSE stream, see below |
| `POST /rooms`                 | anyone  | `{name, settings, timer}`         | Leaves any current room, creates a room with the caller as host. Returns `Room`. |
| `POST /rooms/{id}/join`       | anyone  | `{name}`                          | Leaves any current room, joins as guest. Returns `Room`. |
| `POST /rooms/{id}/leave`      | member  | —                                 | Leaves. |
| `PATCH /rooms/{id}`           | host, co-host | `{settings?, timer?}`             | Replaces the given parts. |
| `POST /rooms/{id}/role`       | host    | `{memberId, role}`                | Sets that member's role to `"cohost"` or `"guest"`. The host's own role cannot change (400); an unknown member is 404. |
| `PUT /me`                     | anyone  | `{name}`                          | Renames the caller in their room. |
| `GET /health`                 | anyone  | —                                 | `200 ok` |

Responses: `POST /rooms`, `join`, `PATCH` and `role` return the `Room`;
`leave` and `PUT /me` return `{}`. `name` in a body is optional and falls back
to the name given on the stream. `PUT /me` while in no room is a 403 (the name
is sent again with the next create or join). Joining the room you are already
in returns it unchanged.

`timer.anchorAt` sent by a client is treated as a boolean: non-null means
"running", and the server replaces it with its own `now`. Errors are
`{error: string}` with 400 (invalid), 403 (not a host or co-host / not the host for `role` / not a member),
404 (no such room), 429 (limits).

## SSE events

- `rooms` — `{now, rooms: RoomSummary[]}`. Sent on connect and whenever the
  list changes (room created, removed, member count, owner name, timer or
  drink changed).
- `room` — `{now, you: memberId, room: Room | null}`. Sent on connect and
  whenever the caller's room changes; `null` when they are in no room or it
  was removed.
- A comment line `: ping` every 25s to keep proxies from closing the stream.

## Lifecycle rules

1. A member is present while their SSE stream is open. When it closes they
   have a 30s grace period to reconnect, then they are removed.
2. When the host leaves or is removed, the co-host with the earliest
   `joinedAt` becomes host; if there is no co-host, the guest with the earliest
   `joinedAt`. The timer is untouched.
3. A room with no members is deleted.
4. A room whose timer has been done for 10 minutes is deleted; its members
   receive `room: null`.
5. Limits: 50 rooms, 20 members per room, names 1–24 chars after trimming,
   request bodies ≤ 4 KB, at most 20 commands per 10s per token.

## Client behaviour

- Host and co-host: local engine is the source of truth; every local change to timer or
  settings is sent with `PATCH`.
- Guest: local engine and settings are overwritten by each `room` event and
  all controls for timer, drink, background and mix are disabled. On leaving,
  the guest's own saved drink, background and mix are restored.
- When the timer is done: a host or co-host choosing "Same again" patches a fresh timer
  for everyone still present; anyone choosing "Another round" leaves the room
  and returns to setup.
- If the server is unreachable the app behaves as a solo timer and retries
  the stream with backoff (2s doubling to 30s).
