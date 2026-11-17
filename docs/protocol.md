# Room protocol

The app is local-first: a timer runs entirely in the browser and keeps working
if the server is unreachable. The server only lets people see and join each
other's timers. It keeps rooms in memory; a restart empties them and
clients re-create their rooms. Profiles are the exception (see below).

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
| `POST /rooms/{id}/notes`      | member  | `{to, text}`                      | Sends a sticky note to another member of the room. Returns `202 {id}`. |
| `PUT /me`                     | anyone  | `{name}`                          | Renames the caller in their room. |
| `GET /health`                 | anyone  | —                                 | `200 ok` |

Responses: `POST /rooms`, `join`, `PATCH` and `role` return the `Room`;
`leave` and `PUT /me` return `{}`; `notes` returns `202 {id}`. `name` in a body is optional and falls back
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
- `note` — `{id, roomId, fromId, fromName, text, sentAt}` (`sentAt` is server
  epoch ms). A sticky note sent to the caller; see below.
- A comment line `: ping` every 25s to keep proxies from closing the stream.

## Sticky notes

Any member can send a short note to any other member of the same room,
whatever their roles. Notes are not part of `Room` or `RoomSummary`.

- `POST /api/rooms/{id}/notes` with `{to: memberId, text}`. The caller must be
  in the room (403, or 404 if the room does not exist); `to` must be another
  member of that room (400 for yourself, 404 for an unknown member or someone
  who has left).
- `text` is trimmed and must be 1 to 140 characters, counted as Unicode code
  points, not bytes. Control characters other than newline (`\n`) are rejected
  with 400, not stripped. Anything else is 400 with `{error}`.
- Rate limit: at most 5 accepted notes per sender token per rolling 60s, then
  429. Rejected requests do not count. This is separate from the general
  command limit.
- Delivery is a `note` event on the recipient's stream, sent once. If the
  recipient has no open stream (for example mid-reconnect), the note waits in a
  per-member queue of at most 20 (the oldest is dropped) and is sent right
  after the initial `rooms` and `room` events when their stream connects. The
  queue is discarded when the member leaves the room or the room is removed.
  Notes are held in memory only. Keeping a note on screen until dismissed is
  the client's job.

## Profiles

A profile stores a display name and a bag of settings under a username, so the
same user gets the same settings on every device. There are no passwords:
anyone who can reach the server can read, replace or delete any profile. The
client decides which keys go in `settings`; the server treats it as opaque.

```ts
type Profile = {
  username: string;    // as first created; cannot be renamed
  displayName: string;
  settings: Record<string, unknown>; // any JSON object
  updatedAt: number;   // server epoch ms
};
```

| Method and path                | Body                                     | Success |
| ------------------------------ | ---------------------------------------- | ------- |
| `GET /profiles`                | —                                        | `200 {profiles: {username, displayName}[]}`, sorted by username ignoring case. |
| `GET /profiles/{username}`     | —                                        | `200 Profile`. 404 `no such profile`. |
| `POST /profiles`               | `{username, displayName?, settings}`     | `201 Profile`. `displayName` defaults to the trimmed username. 409 `that username is taken`; 429 `too many profiles`. |
| `PUT /profiles/{username}`     | `{displayName, settings}` (both required) | `200 {updatedAt}`. Replaces both. 404 if missing. |
| `DELETE /profiles/{username}`  | —                                        | `200 {}`. 404 if missing. |

All of these need the `Authorization: Bearer <token>` header and count toward
the same per-token rate limit as commands.

- Usernames are trimmed and must be 1 to 24 Unicode code points with no
  control characters (400 otherwise). Uniqueness and lookup ignore case
  (`Ada` and `ada` are the same user); the username as first created is the
  one returned. `displayName` follows the same rule as room names.
- `settings` must be a JSON object (`null`, arrays and strings are 400
  `settings must be a JSON object`). It is stored compacted and returned as
  stored. Over 256 KB (262144 bytes) compacted is 400 `settings too large`.
  `POST` and `PUT` bodies may be up to 260 KB; other requests are limited to
  4 KB as usual.
- At most 20 profiles.
- `updatedAt` is the server time of the last change and strictly increases for
  a profile, so clients can compare it.

Unlike rooms, profiles are persistent. They live in one file,
`profiles.json`, in the data directory (`DATA_DIR` or `-data`, `/data` in the
container): `{"version":1,"profiles":[{username, displayName, settings, updatedAt}, …]}`.
Every successful create, replace or delete rewrites it by writing a temporary
file in the same directory, syncing it and renaming it over the old one. If
that fails the change is rolled back and the request is 500
`could not save profiles`. A missing file is an empty store. If the file or
directory cannot be read, or the file is corrupt (invalid JSON, wrong shape,
usernames that collide ignoring case), the server logs it, leaves the file
untouched and answers every `/profiles` request with 503
`profiles are unavailable` until it is fixed and the server restarted.

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
