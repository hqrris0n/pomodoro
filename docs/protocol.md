# Room protocol

The app is local-first: a timer runs entirely in the browser and keeps working
if the server is unreachable. The server only lets people see and join each
other's timers. It keeps rooms in memory; a restart empties them and
clients re-create their rooms. Accounts are the exception (see below).

Transport: JSON over HTTP `POST`/`PATCH` for commands, one Server-Sent Events
stream per client for updates. Go standard library only.

## Identity

Each browser generates a random secret `token` (32 hex chars) once and stores
it. The server never shows a token to anyone else; a member's public `id` is
the first 12 hex chars of `sha256(token)`. Commands carry the token in the
`Authorization: Bearer <token>` header. The SSE stream carries it as
`?token=` because `EventSource` cannot set headers.

A signed-in account also has a session cookie, `cafe_session`, set by the
auth routes (see Accounts). It sits alongside the token: every command still
needs the token, and the cookie says which account the browser is signed in
to.

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
  mixes: SavedMix[];               // the host's saved mixes, see "Shared mixes"
};
type SavedMix = {
  id: string;                      // 1 .. 40 chars, unique in the list
  name: string;                    // 1 .. 30 chars
  mix: Record<string, number>;     // as above
};
type Member = {
  id: string; name: string; role: 'host' | 'cohost' | 'guest';
  joinedAt: number;
  promotedAt?: number | null; // epoch ms of the current promotion; co-hosts only, absent otherwise
};
type Room = {
  id: string; settings: Settings;
  timer: TimerState | null; // null between timers, see below
  timerRev: number;         // starts at 1, +1 every time the timer is replaced or cleared
  members: Member[];       // in succession order: host, co-hosts by promotion, guests by join
};
type RoomSummary = {
  id: string; ownerName: string; memberCount: number; drinkId: string;
  timer: TimerState | null;
};
```

Roles: the **host** is whoever created the room (or was promoted, see
lifecycle rule 2), a **co-host** can control the timer and settings like the
host, and a **guest** is read-only. A room has exactly one host at all times.
Only the host changes other members between co-host and guest, clears the
timer, or starts a timer in a room that has none. New joiners are guests.

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
| `PATCH /rooms/{id}`           | host, co-host | `{settings?, timer?}`             | `timer` is replaced; `timer: null` clears it (host only). `settings` is a partial object, merged into the room's (see below). |
| `POST /rooms/{id}/role`       | host    | `{memberId, role}`                | Sets that member's role to `"cohost"` or `"guest"`. The host's own role cannot change (400); an unknown member is 404. |
| `POST /rooms/{id}/notes`      | member  | `{to, text}`                      | Sends a sticky note to another member of the room. Returns `202 {id}`. |
| `PUT /me`                     | anyone  | `{name}`                          | Renames the caller in their room. |
| `GET /health`                 | anyone  | —                                 | `200 ok` |

Responses: `POST /rooms`, `join`, `PATCH` and `role` return the `Room`;
`leave` and `PUT /me` return `{}`; `notes` returns `202 {id}`. `name` in a body is optional and falls back
to the name given on the stream. `PUT /me` while in no room is a 403 (the name
is sent again with the next create or join). Joining the room you are already
in returns it unchanged.

In `PATCH`, `settings` is partial and every field is optional: `drinkId`,
`backgroundId` and `backgroundRotateMin` are kept when absent and replaced
(same validation as create) when present; `mix` is merged per channel, each key
setting that channel's level, and a level of `0` removes the channel (absent
channels are kept); `mixes` follows "Shared mixes". The merged mix may have at
most 16 channels, else 400 and nothing changes. `settings: {}` is accepted and
changes nothing; a body with neither `settings` nor `timer` is 400. `POST
/rooms` still takes the full settings. Responses and events carry the full
settings.

A missing `timer` keeps the timer and `"timer": null` clears it;
`timerRev` changes only when the timer is replaced or cleared.
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
- `session` — `{now, state: "revoked"}`. Sent to the device whose live session
  was ended by a login on another device, if it has an open stream. The client
  signs out locally, keeps its settings and says it was signed in elsewhere.
  Its next account request would get 401 anyway.
- A comment line `: ping` every 25s to keep proxies from closing the stream.

## Shared mixes

`settings.mixes` is the host's saved sound mixes, at most 40. Everyone in the
room sees that list in their mixer instead of their own; leaving the room
brings their own list back untouched.

- A `PATCH` or `POST /rooms` without `mixes` keeps the room's list (a new room
  starts with `[]`); views always carry the list. Entries that break the limits
  above are 400. Create and `PATCH` bodies may be up to 32 KB because of this.
- The host may replace the list freely (add, rename, delete, reorder).
- A co-host's `PATCH` that carries `mixes` must be the room's current list
  with new mixes added at the end: if any existing mix was removed, renamed,
  changed or moved, it is 403 and nothing changes. Co-hosts do not send
  `mixes` with their ordinary settings patches. Guests get 403 as usual.
- Client: the host sends their own saved list on create and whenever it
  changes. A co-host saving a mix sends the room list plus the new mix, and
  rename, delete and background links are disabled for non-hosts. Background
  links are never shared.
- Adoption: when the host's device sees a room view with mix ids it has never
  seen in this room and does not have, it adds them to its own saved list
  (persisted and profile-synced as usual); a clashing name gets a " (2)"
  suffix. It never deletes or edits its own mixes because of a view, and a mix
  the host deleted is not brought back by a stale view.
- If the host leaves, the room keeps its current list. The promoted device
  adopts the room's mixes as above and from then on publishes its own list
  (its own extra mixes included), so it is the host list going forward.

## Between timers

A room outlives its timers, so the people following a host stay with them
from one order to the next.

1. The host clears the timer with `PATCH {timer: null}` (Restart, or Another
   round when the drink is done). The room keeps its id, members, roles and
   settings; nobody is promoted. A co-host or guest doing this gets 403.
2. While `timer` is null, members get the usual `room` events and the room
   stays in the `rooms` list with `timer: null`. Settings can still be
   patched by the host and co-hosts.
3. The host starts the next timer with `PATCH {timer}` on the same room
   (`POST /rooms` would leave it and create a new one). Every member's next
   `room` event carries the new timer. A co-host starting a timer in a room
   with no timer gets 403; once a timer exists, co-hosts can change it as
   before.
4. A room that has had no timer for 30 minutes is deleted (lifecycle rule 5).
   Settings changes do not extend this.

`timerRev` lets a client tell a stale view from a fresh one: events and
`PATCH` responses can reach a client in either order, so a client that has
seen revision *n* ignores the timer in any view with a lower `timerRev`.

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

## Accounts

An account stores a display name and a bag of settings under a username, so
the same user gets the same settings on every device. Each account has a
password and at most one session at a time. The client decides which keys go
in `settings`; the server treats it as opaque.

```ts
type Profile = {
  username: string; // as first created; cannot be renamed
  displayName: string;
  settings: Record<string, unknown>; // any JSON object
  updatedAt: number; // server epoch ms
};
```

All paths are under `/api`. All need the `Authorization: Bearer <token>`
header and count toward the per-token command limit. Every one of them
answers 503 `profiles are unavailable` if the store is disabled (see Storage).

| Method and path         | Body                                            | Success                                                                                                   | Errors                                                                                                                                                                                                     |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/signup`     | `{username, password, displayName?, settings?}` | `201 Profile` and the session cookie. `displayName` defaults to the trimmed username, `settings` to `{}`. | 400 validation, including `Password must be at least 8 characters.` and `Password must be at most 72 characters.`; 409 `That username is taken.`; 429 `Too many accounts` (50 accounts) or the rate limit. |
| `POST /auth/login`      | `{username, password}`                          | `200 Profile` and the session cookie. Replaces the account's session.                                     | 401 `Wrong username or password.` (the same for an unknown username); 429 rate limit.                                                                                                                      |
| `POST /auth/logout`     | —                                               | `200 {}`. Ends the session and clears the cookie.                                                         |                                                                                                                                                                                                            |
| `GET /account`          | —                                               | `200 Profile`. Re-sends the cookie.                                                                       | 401 `Not signed in.`                                                                                                                                                                                       |
| `PUT /account`          | `{displayName, settings}` (both required)       | `200 {updatedAt}`. Re-sends the cookie.                                                                   | 400 invalid name or settings; 401 `Not signed in.`                                                                                                                                                         |
| `DELETE /account`       | `{password}`                                    | `200 {}`. Deletes the account and clears the cookie.                                                      | 401 `Wrong password.` or `Not signed in.`; 429 rate limit.                                                                                                                                                 |
| `PUT /account/password` | `{current, new}`                                | `200 {}` and a new session cookie. The old session token stops working; this browser stays signed in.     | 400 length (checked before the current password); 401 `Wrong password.` or `Not signed in.`; 429 rate limit.                                                                                               |

`GET /api/profiles` and the other `/api/profiles` routes are gone; they now
answer 404.

Settings must be a JSON object (`null`, arrays and strings are 400
`settings must be a JSON object`). It is stored compacted and returned as
stored. Over 256 KB (262144 bytes) compacted is 400 `settings too large`.
`POST /auth/signup` and `PUT /account` bodies may be up to 260 KB; other
requests are limited to 4 KB as usual.

- Usernames are trimmed and must be 1 to 24 Unicode code points with no
  control characters (400 otherwise). Uniqueness and lookup ignore case
  (`Ada` and `ada` are the same user); the username as first created is the
  one returned. `displayName` follows the same rule as room names.
- Passwords must be 8 to 72 Unicode code points. There are no other rules.
- At most 50 accounts.
- `updatedAt` is the server time of the last change and strictly increases for
  an account, so clients can compare it.

### Sessions and cookies

A successful sign-up, login or password change sets the `cafe_session` cookie.
The per-browser `token` is still required on every command; the cookie only
says which account the browser is signed in to.

- The session token is 32 random bytes, sent as 64 hex characters. The server
  keeps only its SHA-256.
- Cookie: `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000`
  (30 days). Every successful `GET` and `PUT /api/account` sends it again.
- The server-side expiry is renewed when it is more than a day behind, so a
  session lasts 29 to 30 days after its last use.
- One session per account. A login, sign-up or password change gives the
  account a new session and ends the old one: the newest login wins.
- Sessions are stored in `profiles.json`, so they survive a restart.

### Rate limits

Password checks and sign-in have their own limits, separate from the command
limit. Both return 429 `Too many attempts. Wait a minute and try again.`

- Per username: after 5 failed password checks (a wrong login, or a wrong
  password on delete or password change) in a rolling minute, login, delete
  and password change for that username are refused, even with the right
  password, until the failures age out.
- Per client address: at most 20 sign-up, login and password-change attempts
  per rolling minute. Every attempt counts, not only failures.
- The client address is the host of the connection's address. With
  `-trust-proxy` (or `TRUST_PROXY=1`, set in `compose.yml`) it is instead the
  rightmost `X-Forwarded-For` entry. Only turn this on behind a proxy that sets
  that header; otherwise a client can choose its own address.

### Storage

Accounts live in one file, `profiles.json`, in the data directory (`DATA_DIR`
or `-data`, `/data` in the container):
`{"version":2,"profiles":[{username, displayName, settings, updatedAt, passwordHash, sessionHash, sessionExpires, sessionGen}, …]}`.

- `passwordHash` is `pbkdf2-sha256$<iterations>$<salt b64>$<hash b64>`:
  PBKDF2-SHA256, 600,000 iterations, a 16-byte random salt. Passwords are
  compared in constant time. An unknown username is checked against a dummy
  hash, so it takes as long as a wrong password.
- At most two hashes run at once.
- `sessionHash` is the hex SHA-256 of the session token (`""` when signed out),
  `sessionExpires` is unix ms, and `sessionGen` counts the account's sessions.

Every successful create, replace or delete rewrites the file by writing a
temporary file in the same directory, syncing it and renaming it over the old
one. If that fails the change is rolled back and the request is 500
`could not save profiles`. A missing file is an empty store. If the file or
directory cannot be read, or the file is corrupt (invalid JSON, wrong shape,
usernames that collide ignoring case), the server logs it, leaves the file
untouched and answers every account request with 503
`profiles are unavailable` until it is fixed and the server restarted.

### Migration from version 1

A version 1 file has no passwords. On load every account keeps its settings
and display name and gets the password `12345678`. The file is rewritten as
version 2 on the first change.

**Risk:** anyone who knows that default can sign in to a migrated account
until its owner changes the password. Nothing forces a reset, so tell users to
change it in Settings after the upgrade.

### One server process

Sign-up uniqueness, the one-session rule and the room handover rely on locks
inside one process. Run one server process per data file; several replicas
sharing a `profiles.json` are not supported.

## Signing in on another device

The server links each account to the device token that holds its session. The
link is made by sign-up, login, password change, and `GET` or `PUT
/api/account`. It is kept in memory, not in `profiles.json`, so after a restart
it is made again the next time that device calls one of those routes.

When a login replaces a live session and the old device is in a room:

1. The old device gets a `session` SSE event (see SSE events).
2. The new device takes over the old device's member entry in place: same
   name, role (host, co-host or guest), join time and position, whatever the
   timer is doing. Before that it leaves any room it was in, under the usual
   leave rules.
3. The old device rejoins the room as a guest under its own name, if there is
   space (20 members). If the room is full, it leaves.

The member's public `id` changes, because it derives from the device token.
If the old device was in no room, only step 1 happens.

If two logins race, the per-account session generation decides: the device
with the surviving session ends up with the role, whatever order the requests
reach the server in.

## Lifecycle rules

1. A member is present while their SSE stream is open. When it closes they
   have a 30s grace period to reconnect, then they are removed.
2. When the host leaves or is removed, the co-host promoted earliest
   (smallest `promotedAt`) becomes host; if there is no co-host, the guest with
   the earliest `joinedAt`. A co-host who is demoted and promoted again goes to
   the back of the co-host queue; a demoted co-host rejoins the guest queue at
   their original join position; promoting a co-host again changes nothing. A
   login handover keeps the seat's place in both queues. The timer is
   untouched, including a cleared one: the new host orders the next timer. Clearing the timer is not leaving.
3. A room with no members is deleted.
4. A room whose timer has been done for 10 minutes is deleted; its members
   receive `room: null`.
5. A room whose timer has been cleared for 30 minutes is deleted; its members
   receive `room: null`.
6. Limits: 50 rooms, 20 members per room, names 1–24 chars after trimming,
   request bodies ≤ 4 KB, at most 20 commands per 10s per token.

## Client behaviour

- Host and co-host: local engine is the source of truth; every local change to timer or
  settings is sent with `PATCH`. A settings patch carries only what differs from the
  settings last known to be on the server: changed scalar fields, and in `mix` only the
  channels whose level changed (a channel turned off is `0`). A room event that arrives
  while a local change waits in the 300 ms debounce does not overwrite the pending
  fields and channels; they are sent when the debounce fires.
- Guest: local engine and settings are overwritten by each `room` event and
  all controls for timer, drink, background and mix are disabled, and the
  host's saved mixes replace their own in the mixer. On leaving,
  the guest's own saved drink, background and mix are restored.
- Host and co-host send timer patches one at a time, each after the previous
  one is answered, so the server applies them in order. While one is in
  flight, and for views older than the newest `timerRev` seen, the local
  timer is kept. A client also ignores `room` events for a room it has just
  left until it sees `room: null` or another room.
- The host's Restart (while running) and Another round (when done) clear the
  timer and return the host to the order ticket, still in the room; Start
  brewing then patches the new timer into it. Same again (host or co-host)
  patches a fresh timer.
- Guests and co-hosts: Leave (or Another round / Back to my own timer) leaves
  the room. While the room has no timer they see a waiting screen with a
  Leave button and cannot order; the next timer takes over automatically.
  Rooms with no timer are not offered in the list of timers to join.
- If the server is unreachable the app behaves as a solo timer and retries
  the stream with backoff (2s doubling to 30s).

## Concurrency

### Settings changes

Host and co-hosts can change settings at the same time. A patch that carried
the whole settings object would let the later request silently undo another
person's change to a different field, so settings patches are partial and the
server merges them under its lock: changes to different fields, or to different
mix channels, all survive. Only when two people change the same field or the
same channel does the request the server handles last win.

### Host succession

Two queues decide who hosts next: co-hosts in the order they were promoted,
then guests in the order they joined. The choice is made inside the same
locked step that removes the leaving host, so a room never has zero or two
hosts, even when joins, role changes and leaves arrive at the same moment.
Promotions are ordered by a counter shared by the whole server, not by
`promotedAt`, so two promotions in the same millisecond still have a fixed
order.
