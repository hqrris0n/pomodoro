package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
	"sync"
	"time"
)

const (
	maxRooms          = 50
	maxMembers        = 20
	maxStreams        = 200
	maxClients        = 2000 // streams + members + a little slack for rate records
	gracePeriod       = 30 * time.Second
	finishedRoomTTL   = 10 * time.Minute
	rateWindow        = 10 * time.Second
	rateLimit         = 20
	streamBufferSize  = 16
	roomIDRandomBytes = 4
)

type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

var (
	errNoRoom      = &apiError{404, "no such room"}
	errNotMember   = &apiError{403, "not a member of that room"}
	errNotOwner    = &apiError{403, "only an owner can do that"}
	errNoMember    = &apiError{404, "no such member"}
	errRoomsFull   = &apiError{429, "too many rooms"}
	errRoomFull    = &apiError{429, "room is full"}
	errRateLimited = &apiError{429, "too many requests"}
	errBusy        = &apiError{429, "server is busy"}
)

// hub owns all state behind one mutex. Every exported method locks it, mutates,
// then calls publish before unlocking so events always reflect committed state.
type hub struct {
	mu        sync.Mutex
	now       func() time.Time
	logf      func(format string, args ...any)
	rooms     map[string]*room
	clients   map[string]*client // keyed by token; removed by sweep when idle
	nextSeq   uint64
	streams   int
	lastRooms []byte // last broadcast room list, to skip no-op broadcasts
	dirty     map[*client]struct{}
}

type room struct {
	id       string
	seq      uint64 // creation order, for a stable list
	settings Settings
	timer    Timer
	setAt    time.Time // when timer was last replaced (finish time of a paused, finished timer)
	members  []*member // in join order; index 0 is the earliest joiner
}

type member struct {
	c        *client
	name     string
	role     string
	joinedAt int64
}

// client is everything we know about one token. It outlives its stream so a
// reconnect within the grace period keeps the member and role.
type client struct {
	token      string
	id         string // public member id
	name       string // display name from the stream URL / last PUT /me
	roomID     string
	conn       *conn
	detachedAt time.Time // when the stream was last absent (zero while connected)
	cmds       []time.Time
}

// conn is one SSE connection. The hub sends frames on ch; done is closed when
// the hub replaces or drops the connection.
type conn struct {
	token string
	ch    chan []byte
	done  chan struct{}
	once  sync.Once
}

func (c *conn) close() { c.once.Do(func() { close(c.done) }) }

func newHub(now func() time.Time, logf func(string, ...any)) *hub {
	return &hub{
		now:       now,
		logf:      logf,
		rooms:     map[string]*room{},
		clients:   map[string]*client{},
		lastRooms: []byte("[]"),
		dirty:     map[*client]struct{}{},
	}
}

func memberID(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])[:12]
}

// --- client bookkeeping (lock held) ---

func (h *hub) clientLocked(token string) (*client, error) {
	if c, ok := h.clients[token]; ok {
		return c, nil
	}
	if len(h.clients) >= maxClients {
		return nil, errBusy
	}
	c := &client{token: token, id: memberID(token), detachedAt: h.now()}
	h.clients[token] = c
	return c, nil
}

// pruneCmds drops rate-limit records older than the window.
func (c *client) pruneCmds(now time.Time) {
	i := 0
	for i < len(c.cmds) && now.Sub(c.cmds[i]) >= rateWindow {
		i++
	}
	c.cmds = c.cmds[i:]
}

// Allow records one command for the token and reports errRateLimited when the
// token has used up its budget.
func (h *hub) Allow(token string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return err
	}
	now := h.now()
	c.pruneCmds(now)
	if len(c.cmds) >= rateLimit {
		return errRateLimited
	}
	c.cmds = append(c.cmds, now)
	return nil
}

// --- events (lock held) ---

func frame(event string, v any) []byte {
	b, _ := json.Marshal(v) // our own types always marshal
	var buf bytes.Buffer
	buf.WriteString("event: " + event + "\ndata: ")
	buf.Write(b)
	buf.WriteString("\n\n")
	return buf.Bytes()
}

func (h *hub) nowMs() int64 { return h.now().UnixMilli() }

func (r *room) view() Room {
	ms := make([]Member, len(r.members))
	for i, m := range r.members {
		ms[i] = Member{ID: m.c.id, Name: m.name, Role: m.role, JoinedAt: m.joinedAt}
	}
	return Room{ID: r.id, Settings: r.settings, Timer: r.timer, Members: ms}
}

func (r *room) ownerName() string {
	for _, m := range r.members {
		if m.role == roleOwner {
			return m.name
		}
	}
	return ""
}

func (h *hub) summaries() []RoomSummary {
	rs := make([]*room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rs = append(rs, r)
	}
	sort.Slice(rs, func(i, j int) bool { return rs[i].seq < rs[j].seq })
	out := make([]RoomSummary, len(rs))
	for i, r := range rs {
		out[i] = RoomSummary{ID: r.id, OwnerName: r.ownerName(), MemberCount: len(r.members),
			DrinkID: r.settings.DrinkID, Timer: r.timer}
	}
	return out
}

func (h *hub) roomsFrame(list []RoomSummary) []byte {
	return frame("rooms", struct {
		Now   int64         `json:"now"`
		Rooms []RoomSummary `json:"rooms"`
	}{h.nowMs(), list})
}

func (h *hub) roomFrame(c *client) []byte {
	var view *Room
	if r := h.rooms[c.roomID]; r != nil {
		v := r.view()
		view = &v
	}
	return frame("room", struct {
		Now  int64  `json:"now"`
		You  string `json:"you"`
		Room *Room  `json:"room"`
	}{h.nowMs(), c.id, view})
}

// send never blocks: a client whose buffer is full is dropped and will
// reconnect, which resends full state.
func (h *hub) send(c *client, f []byte) {
	if c.conn == nil {
		return
	}
	select {
	case c.conn.ch <- f:
	default:
		h.dropLocked(c)
	}
}

func (h *hub) dropLocked(c *client) {
	if c.conn == nil {
		return
	}
	c.conn.close()
	c.conn = nil
	c.detachedAt = h.now()
	h.streams--
}

// publish sends a room event to every touched client and a rooms event to
// everyone if the public list changed.
func (h *hub) publish() {
	for c := range h.dirty {
		h.send(c, h.roomFrame(c))
		delete(h.dirty, c)
	}
	list := h.summaries()
	cur, _ := json.Marshal(list)
	if bytes.Equal(cur, h.lastRooms) {
		return
	}
	h.lastRooms = cur
	f := h.roomsFrame(list)
	for _, c := range h.clients {
		h.send(c, f)
	}
}

// --- streams ---

// Connect registers the caller's stream, replacing any earlier one, and queues
// the initial rooms and room events. The caller must call Detach when done.
func (h *hub) Connect(token, name string) (*conn, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return nil, err
	}
	if c.conn == nil && h.streams >= maxStreams {
		return nil, &apiError{429, "too many streams"}
	}
	if c.conn != nil {
		h.dropLocked(c)
	}
	if name != "" {
		c.name = name
	}
	cn := &conn{token: token, ch: make(chan []byte, streamBufferSize), done: make(chan struct{})}
	c.conn = cn
	c.detachedAt = time.Time{}
	h.streams++
	cn.ch <- h.roomsFrame(h.summaries())
	cn.ch <- h.roomFrame(c)
	return cn, nil
}

// Detach marks the stream as gone; the member keeps their place for the grace
// period. It does nothing if the stream was already replaced or dropped.
func (h *hub) Detach(cn *conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c := h.clients[cn.token]; c != nil && c.conn == cn {
		h.dropLocked(c)
	}
}

// CloseStreams ends every stream (used on shutdown).
func (h *hub) CloseStreams() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for _, c := range h.clients {
		h.dropLocked(c)
	}
}

// --- membership (lock held) ---

func (h *hub) newRoomID() string {
	for {
		b := make([]byte, roomIDRandomBytes)
		_, _ = rand.Read(b)
		id := hex.EncodeToString(b)
		if _, taken := h.rooms[id]; !taken {
			return id
		}
	}
}

func (h *hub) touchAll(r *room) {
	for _, m := range r.members {
		h.dirty[m.c] = struct{}{}
	}
}

// leaveLocked removes c from their room, promoting the earliest joiner if no
// owner is left, and deleting the room if it is empty.
func (h *hub) leaveLocked(c *client) {
	r := h.rooms[c.roomID]
	c.roomID = ""
	if r == nil {
		return
	}
	h.dirty[c] = struct{}{}
	for i, m := range r.members {
		if m.c == c {
			r.members = append(r.members[:i], r.members[i+1:]...)
			break
		}
	}
	if len(r.members) == 0 {
		delete(h.rooms, r.id)
		h.logf("room %s removed (empty)", r.id)
		return
	}
	if !hasOwner(r) {
		r.members[0].role = roleOwner
	}
	h.touchAll(r)
}

func hasOwner(r *room) bool {
	for _, m := range r.members {
		if m.role == roleOwner {
			return true
		}
	}
	return false
}

// resolveName picks the body name, falling back to the stream's name.
func resolveName(c *client, name string) (string, error) {
	if name == "" {
		name = c.name
	}
	return validateName(name)
}

// memberOf finds the room and the caller's membership in it.
func (h *hub) memberOf(c *client, roomID string) (*room, *member, error) {
	r := h.rooms[roomID]
	if r == nil {
		return nil, nil, errNoRoom
	}
	for _, m := range r.members {
		if m.c == c {
			return r, m, nil
		}
	}
	return nil, nil, errNotMember
}

func (h *hub) ownerOf(c *client, roomID string) (*room, error) {
	r, m, err := h.memberOf(c, roomID)
	if err != nil {
		return nil, err
	}
	if m.role != roleOwner {
		return nil, errNotOwner
	}
	return r, nil
}

// --- commands ---

// CreateRoom leaves the caller's current room and creates a new one. name may
// be empty to use the name given on the stream.
func (h *hub) CreateRoom(token, name string, s Settings, t Timer) (Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return Room{}, err
	}
	if name, err = resolveName(c, name); err != nil {
		return Room{}, err
	}
	// Leaving a room we are alone in frees a slot, so it does not count.
	cur := h.rooms[c.roomID]
	if len(h.rooms) >= maxRooms && !(cur != nil && len(cur.members) == 1) {
		return Room{}, errRoomsFull
	}
	h.leaveLocked(c)
	h.nextSeq++
	r := &room{id: h.newRoomID(), seq: h.nextSeq, settings: s, timer: t, setAt: h.now()}
	r.members = []*member{{c: c, name: name, role: roleOwner, joinedAt: h.nowMs()}}
	h.rooms[r.id] = r
	c.roomID = r.id
	h.dirty[c] = struct{}{}
	h.logf("room %s created", r.id)
	h.publish()
	return r.view(), nil
}

// Join adds the caller as a visitor. Joining the room you are already in is a no-op.
func (h *hub) Join(token, roomID, name string) (Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return Room{}, err
	}
	r := h.rooms[roomID]
	if r == nil {
		return Room{}, errNoRoom
	}
	if c.roomID == roomID {
		return r.view(), nil
	}
	if name, err = resolveName(c, name); err != nil {
		return Room{}, err
	}
	if len(r.members) >= maxMembers {
		return Room{}, errRoomFull
	}
	h.leaveLocked(c)
	r.members = append(r.members, &member{c: c, name: name, role: roleVisitor, joinedAt: h.nowMs()})
	c.roomID = r.id
	h.touchAll(r)
	h.publish()
	return r.view(), nil
}

func (h *hub) Leave(token, roomID string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return err
	}
	if _, _, err := h.memberOf(c, roomID); err != nil {
		return err
	}
	h.leaveLocked(c)
	h.publish()
	return nil
}

// Patch replaces the given parts of the room; owners only. A nil part is kept.
func (h *hub) Patch(token, roomID string, s *Settings, t *Timer) (Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return Room{}, err
	}
	r, err := h.ownerOf(c, roomID)
	if err != nil {
		return Room{}, err
	}
	if s != nil {
		r.settings = *s
	}
	if t != nil {
		r.timer = *t
		r.setAt = h.now()
	}
	h.touchAll(r)
	h.publish()
	return r.view(), nil
}

// Promote makes another member an owner; owners only. An unknown member id is
// 404 (the room exists, the member does not), checked after the caller's own
// permission so that non-owners learn nothing about membership.
func (h *hub) Promote(token, roomID, targetID string) (Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return Room{}, err
	}
	r, err := h.ownerOf(c, roomID)
	if err != nil {
		return Room{}, err
	}
	for _, m := range r.members {
		if m.c.id == targetID {
			m.role = roleOwner
			h.touchAll(r)
			h.publish()
			return r.view(), nil
		}
	}
	return Room{}, errNoMember
}

// Rename changes the caller's display name, in their room if they are in one.
func (h *hub) Rename(token, name string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return err
	}
	r := h.rooms[c.roomID]
	if r == nil {
		return errNotMember
	}
	c.name = name
	for _, m := range r.members {
		if m.c == c {
			m.name = name
		}
	}
	h.touchAll(r)
	h.publish()
	return nil
}

// --- lifecycle ---

// finishedAt returns when the room's timer completed, if it has.
func (h *hub) finishedAt(r *room) (time.Time, bool) {
	t := r.timer
	total := t.total()
	if t.AnchorAt == nil {
		return r.setAt, t.ElapsedMs >= total
	}
	return time.UnixMilli(*t.AnchorAt + total - t.ElapsedMs), true
}

// Sweep applies lifecycle rules 1 and 4: it deletes rooms finished for over
// ten minutes, removes members whose grace period ran out, and forgets idle
// clients (including their rate-limit records).
func (h *hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	now := h.now()

	for id, r := range h.rooms {
		if at, ok := h.finishedAt(r); ok && now.Sub(at) >= finishedRoomTTL {
			for _, m := range r.members {
				m.c.roomID = ""
				h.dirty[m.c] = struct{}{}
			}
			delete(h.rooms, id)
			h.logf("room %s removed (finished)", id)
		}
	}
	for _, c := range h.clients {
		if c.conn == nil && c.roomID != "" && now.Sub(c.detachedAt) >= gracePeriod {
			h.leaveLocked(c)
		}
	}
	for token, c := range h.clients {
		c.pruneCmds(now)
		if c.conn == nil && c.roomID == "" && len(c.cmds) == 0 {
			delete(h.clients, token)
		}
	}
	h.publish()
}

// runJanitor sweeps every interval until stop is closed.
func (h *hub) runJanitor(interval time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			h.Sweep()
		case <-stop:
			return
		}
	}
}
