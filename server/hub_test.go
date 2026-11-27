package main

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

func newTestHub() (*hub, *fakeClock) {
	clk := &fakeClock{t: time.UnixMilli(1_700_000_000_000)}
	return newHub(clk.Now, func(string, ...any) {}), clk
}

// tok makes a distinct valid token for n.
func tok(n int) string { return fmt.Sprintf("%032x", n) }

func testSettings() Settings {
	return Settings{DrinkID: "latte", BackgroundID: "window", Mix: map[string]float64{"rain": 0.5}}
}

func testTimer(h *hub, running bool) Timer {
	in := timerIn{FocusMs: 1_500_000, BreakMs: 300_000, Rounds: 2}
	if running {
		one := 1.0
		in.AnchorAt = &one
	}
	t, err := validateTimer(in, h.nowMs())
	if err != nil {
		panic(err)
	}
	return t
}

type event struct {
	name string
	data map[string]any
	raw  string
}

// drain returns every frame queued on cn without blocking.
func drain(cn *conn) []event {
	var out []event
	for {
		select {
		case f := <-cn.ch:
			s := string(f)
			name, rest, _ := strings.Cut(strings.TrimPrefix(s, "event: "), "\ndata: ")
			var data map[string]any
			if err := json.Unmarshal([]byte(strings.TrimSpace(rest)), &data); err != nil {
				panic(err)
			}
			out = append(out, event{name, data, s})
		default:
			return out
		}
	}
}

func lastOf(evs []event, name string) *event {
	for i := len(evs) - 1; i >= 0; i-- {
		if evs[i].name == name {
			return &evs[i]
		}
	}
	return nil
}

func mustCreate(t *testing.T, h *hub, token, name string) Room {
	t.Helper()
	r, err := h.CreateRoom(token, name, testSettings(), testTimer(h, false))
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func mustJoin(t *testing.T, h *hub, token, roomID, name string) {
	t.Helper()
	if _, err := h.Join(token, roomID, name); err != nil {
		t.Fatal(err)
	}
}

func roleOf(r Room, token string) string {
	for _, m := range r.Members {
		if m.ID == memberID(token) {
			return m.Role
		}
	}
	return ""
}

func (h *hub) room(id string) (Room, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r == nil {
		return Room{}, false
	}
	return r.view(), true
}

func wantStatus(t *testing.T, err error, status int) {
	t.Helper()
	ae, ok := err.(*apiError)
	if !ok || ae.status != status {
		t.Fatalf("want status %d, got %v", status, err)
	}
}

func TestCreateMakesCreatorSoleHostAndAnnouncesIt(t *testing.T) {
	h, _ := newTestHub()
	watcher, _ := h.Connect(tok(9), "")
	drain(watcher)

	r := mustCreate(t, h, tok(1), "Ada")
	if len(r.Members) != 1 || r.Members[0].Role != roleHost || r.Members[0].Name != "Ada" {
		t.Fatalf("members = %+v", r.Members)
	}
	ev := lastOf(drain(watcher), "rooms")
	if ev == nil {
		t.Fatal("no rooms event")
	}
	list := ev.data["rooms"].([]any)
	sum := list[0].(map[string]any)
	if sum["ownerName"] != "Ada" || sum["memberCount"] != 1.0 || sum["drinkId"] != "latte" || sum["id"] != r.ID {
		t.Fatalf("summary = %v", sum)
	}
	if sum["timer"].(map[string]any)["focusMs"] != 1_500_000.0 {
		t.Fatalf("timer = %v", sum["timer"])
	}
}

func TestValidateTimerAnchor(t *testing.T) {
	one := 12345.0
	cases := []struct {
		name   string
		anchor *float64
		want   *int64
	}{
		{"running is re-anchored to server now", &one, ptr(int64(777))},
		{"paused stays null", nil, nil},
	}
	for _, c := range cases {
		got, err := validateTimer(timerIn{FocusMs: 60_000, BreakMs: 300_000, Rounds: 1, AnchorAt: c.anchor}, 777)
		if err != nil {
			t.Fatal(c.name, err)
		}
		if (got.AnchorAt == nil) != (c.want == nil) || (c.want != nil && *got.AnchorAt != *c.want) {
			t.Fatalf("%s: got %v", c.name, got.AnchorAt)
		}
	}
}

func ptr[T any](v T) *T { return &v }

func TestJoinAsGuestAndSwitchRooms(t *testing.T) {
	h, _ := newTestHub()
	a := mustCreate(t, h, tok(1), "Ada")
	b := mustCreate(t, h, tok(2), "Bo")
	mustJoin(t, h, tok(3), a.ID, "Cy")
	got, _ := h.room(a.ID)
	if roleOf(got, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", got.Members)
	}
	// Joining b leaves a, which keeps its owner.
	mustJoin(t, h, tok(3), b.ID, "Cy")
	got, _ = h.room(a.ID)
	if len(got.Members) != 1 {
		t.Fatalf("a still has %+v", got.Members)
	}
	// Creating a room while in b leaves b.
	mustCreate(t, h, tok(3), "Cy")
	got, _ = h.room(b.ID)
	if len(got.Members) != 1 {
		t.Fatalf("b still has %+v", got.Members)
	}
}

func TestPatchPermissions(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	mustJoin(t, h, tok(2), r.ID, "Bo")
	visitor, _ := h.Connect(tok(2), "")
	drain(visitor)

	newTimer := testTimer(h, true)
	_, err := h.Patch(tok(2), r.ID, nil, &newTimer, false)
	wantStatus(t, err, 403)
	if got, _ := h.room(r.ID); got.Timer.AnchorAt != nil {
		t.Fatal("visitor changed state")
	}
	if len(drain(visitor)) != 0 {
		t.Fatal("rejected patch produced events")
	}

	if _, err := h.Patch(tok(1), r.ID, nil, &newTimer, false); err != nil {
		t.Fatal(err)
	}
	ev := lastOf(drain(visitor), "room")
	if ev == nil || ev.data["room"].(map[string]any)["timer"].(map[string]any)["anchorAt"] == nil {
		t.Fatalf("visitor did not see the new timer: %+v", ev)
	}
}

func TestSetRole(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	mustJoin(t, h, tok(2), r.ID, "Bo")
	mustJoin(t, h, tok(3), r.ID, "Cy")

	// Only the host may change roles; a guest and a co-host both get 403.
	_, err := h.SetRole(tok(2), r.ID, memberID(tok(3)), roleCohost)
	wantStatus(t, err, 403)
	if _, err := h.SetRole(tok(1), r.ID, memberID(tok(2)), roleCohost); err != nil {
		t.Fatal(err)
	}
	_, err = h.SetRole(tok(2), r.ID, memberID(tok(3)), roleCohost)
	wantStatus(t, err, 403)
	// The host's own role cannot change; bad roles are 400; unknown members 404.
	_, err = h.SetRole(tok(1), r.ID, memberID(tok(1)), roleGuest)
	wantStatus(t, err, 400)
	_, err = h.SetRole(tok(1), r.ID, memberID(tok(3)), roleHost)
	wantStatus(t, err, 400)
	_, err = h.SetRole(tok(1), r.ID, "nobody00000", roleCohost)
	wantStatus(t, err, 404)

	got, _ := h.room(r.ID)
	if roleOf(got, tok(1)) != roleHost || roleOf(got, tok(2)) != roleCohost || roleOf(got, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", got.Members)
	}
	got, err = h.SetRole(tok(1), r.ID, memberID(tok(2)), roleGuest)
	if err != nil {
		t.Fatal(err)
	}
	if roleOf(got, tok(2)) != roleGuest {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestHostLeavingPrefersEarliestCohostThenEarliestGuest(t *testing.T) {
	h, clk := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	for i, n := range []string{"Bo", "Cy", "Di"} {
		clk.Advance(time.Second)
		mustJoin(t, h, tok(i+2), r.ID, n)
	}
	// Di (joined last) is the only co-host, so beats the earlier guests.
	if _, err := h.SetRole(tok(1), r.ID, memberID(tok(4)), roleCohost); err != nil {
		t.Fatal(err)
	}
	before, _ := h.room(r.ID)
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	after, _ := h.room(r.ID)
	if roleOf(after, tok(4)) != roleHost || roleOf(after, tok(2)) != roleGuest || roleOf(after, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", after.Members)
	}
	if *after.Timer != *before.Timer {
		t.Fatal("timer changed")
	}
	// No co-hosts left: the earliest guest (Bo) takes over.
	if err := h.Leave(tok(4), r.ID); err != nil {
		t.Fatal(err)
	}
	after, _ = h.room(r.ID)
	if roleOf(after, tok(2)) != roleHost || roleOf(after, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", after.Members)
	}
}

func TestHostLeavingPassesHostToEarliestJoiner(t *testing.T) {
	h, clk := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(2), r.ID, "Bo")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(3), r.ID, "Cy")
	before, _ := h.room(r.ID)

	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	after, _ := h.room(r.ID)
	if roleOf(after, tok(2)) != roleHost || roleOf(after, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", after.Members)
	}
	if *after.Timer != *before.Timer {
		t.Fatal("timer changed")
	}
}

func TestGracePeriod(t *testing.T) {
	h, clk := newTestHub()
	cn, _ := h.Connect(tok(1), "")
	r := mustCreate(t, h, tok(1), "Ada")
	clk.Advance(time.Second)
	cn2, _ := h.Connect(tok(2), "")
	mustJoin(t, h, tok(2), r.ID, "Bo")
	joined, _ := h.room(r.ID)

	h.Detach(cn)
	clk.Advance(29 * time.Second)
	h.Sweep()
	if got, _ := h.room(r.ID); len(got.Members) != 2 {
		t.Fatal("removed inside the grace period")
	}
	// Reconnect: same role and joinedAt, and the grace clock restarts.
	cn, _ = h.Connect(tok(1), "")
	drain(cn)
	clk.Advance(time.Minute)
	h.Sweep()
	if got, _ := h.room(r.ID); got.Members[0] != joined.Members[0] {
		t.Fatalf("member changed: %+v vs %+v", got.Members[0], joined.Members[0])
	}

	h.Detach(cn)
	clk.Advance(30 * time.Second)
	h.Sweep()
	got, _ := h.room(r.ID)
	if len(got.Members) != 1 || roleOf(got, tok(2)) != roleHost {
		t.Fatalf("members = %+v", got.Members)
	}
	// Once the last member's stream is gone and the grace period ends, the room goes.
	h.Detach(cn2)
	clk.Advance(30 * time.Second)
	h.Sweep()
	if _, ok := h.room(r.ID); ok {
		t.Fatal("empty room survived")
	}
}

func TestFinishedRoomIsDeleted(t *testing.T) {
	h, clk := newTestHub()
	cn, _ := h.Connect(tok(1), "")
	r, err := h.CreateRoom(tok(1), "Ada", testSettings(), func() Timer {
		t, _ := validateTimer(timerIn{FocusMs: 60_000, BreakMs: 300_000, Rounds: 1, AnchorAt: ptr(1.0)}, h.nowMs())
		return t
	}())
	if err != nil {
		t.Fatal(err)
	}
	drain(cn)

	clk.Advance(time.Minute + 10*time.Minute - time.Second)
	h.Sweep()
	if _, ok := h.room(r.ID); !ok {
		t.Fatal("deleted too early")
	}
	clk.Advance(time.Second)
	h.Sweep()
	if _, ok := h.room(r.ID); ok {
		t.Fatal("finished room survived")
	}
	ev := lastOf(drain(cn), "room")
	if ev == nil || ev.data["room"] != nil {
		t.Fatalf("want room null, got %+v", ev)
	}
}

func TestLimits(t *testing.T) {
	t.Run("51st room", func(t *testing.T) {
		h, _ := newTestHub()
		for i := 1; i <= maxRooms; i++ {
			mustCreate(t, h, tok(i), "x")
		}
		_, err := h.CreateRoom(tok(99), "x", testSettings(), testTimer(h, false))
		wantStatus(t, err, 429)
		// A sole owner starting a new room frees their old one, so it is allowed.
		mustCreate(t, h, tok(1), "x")
	})
	t.Run("21st member", func(t *testing.T) {
		h, _ := newTestHub()
		r := mustCreate(t, h, tok(1), "x")
		for i := 2; i <= maxMembers; i++ {
			mustJoin(t, h, tok(i), r.ID, "x")
		}
		_, err := h.Join(tok(99), r.ID, "x")
		wantStatus(t, err, 429)
	})
	t.Run("21st command in 10s", func(t *testing.T) {
		h, clk := newTestHub()
		for i := 0; i < rateLimit; i++ {
			if err := h.Allow(tok(1)); err != nil {
				t.Fatal(i, err)
			}
		}
		wantStatus(t, h.Allow(tok(1)), 429)
		clk.Advance(rateWindow)
		if err := h.Allow(tok(1)); err != nil {
			t.Fatal(err)
		}
	})
}

func TestNoTokensInEvents(t *testing.T) {
	h, _ := newTestHub()
	a, b := tok(0xaaaa), tok(0xbbbb)
	r := mustCreate(t, h, a, "Ada")
	cn, _ := h.Connect(b, "")
	mustJoin(t, h, b, r.ID, "Bo")
	if _, err := h.SetRole(a, r.ID, memberID(b), roleCohost); err != nil {
		t.Fatal(err)
	}
	evs := drain(cn)
	if lastOf(evs, "room") == nil {
		t.Fatal("no room event")
	}
	for _, e := range evs {
		if strings.Contains(e.raw, a) || strings.Contains(e.raw, b) {
			t.Fatalf("token leaked in %s", e.raw)
		}
	}
}

func TestSlowStreamIsDroppedAndNewStreamReplacesOld(t *testing.T) {
	h, _ := newTestHub()
	slow, _ := h.Connect(tok(1), "")
	for i := 2; i < 2+streamBufferSize+1; i++ {
		mustCreate(t, h, tok(i), "x") // each changes the room list
	}
	select {
	case <-slow.done:
	default:
		t.Fatal("slow stream was not dropped")
	}

	first, _ := h.Connect(tok(500), "")
	second, _ := h.Connect(tok(500), "")
	select {
	case <-first.done:
	default:
		t.Fatal("first stream not replaced")
	}
	h.Detach(first) // must not disturb the new stream
	select {
	case <-second.done:
		t.Fatal("second stream closed by stale detach")
	default:
	}
}

func TestSweepForgetsIdleClients(t *testing.T) {
	h, clk := newTestHub()
	_ = h.Allow(tok(1))
	clk.Advance(rateWindow)
	h.Sweep()
	h.mu.Lock()
	n := len(h.clients)
	h.mu.Unlock()
	if n != 0 {
		t.Fatalf("%d client records left", n)
	}
}

func TestStreamNameIsUsedWhenBodyHasNone(t *testing.T) {
	h, _ := newTestHub()
	_, _ = h.Connect(tok(1), "Streamy")
	r := mustCreate(t, h, tok(1), "")
	if r.Members[0].Name != "Streamy" {
		t.Fatalf("name = %q", r.Members[0].Name)
	}
	if err := h.Rename(tok(1), "New"); err != nil {
		t.Fatal(err)
	}
	if got, _ := h.room(r.ID); got.Members[0].Name != "New" {
		t.Fatal("rename not applied")
	}
}

// noteSetup makes a room with Ada (host, tok 1), Bo (tok 2) and Cy (tok 3),
// all connected, with their initial events drained.
func noteSetup(t *testing.T) (*hub, *fakeClock, string, [4]*conn) {
	t.Helper()
	h, clk := newTestHub()
	var cns [4]*conn
	for i := 1; i <= 3; i++ {
		cn, err := h.Connect(tok(i), fmt.Sprintf("U%d", i))
		if err != nil {
			t.Fatal(err)
		}
		cns[i] = cn
	}
	room := mustCreate(t, h, tok(1), "Ada")
	mustJoin(t, h, tok(2), room.ID, "Bo")
	mustJoin(t, h, tok(3), room.ID, "Cy")
	for i := 1; i <= 3; i++ {
		drain(cns[i])
	}
	return h, clk, room.ID, cns
}

func notesIn(evs []event) []event {
	var out []event
	for _, e := range evs {
		if e.name == "note" {
			out = append(out, e)
		}
	}
	return out
}

func TestNoteDeliveredToRecipientOnly(t *testing.T) {
	h, _, rid, cns := noteSetup(t)
	id, err := h.SendNote(tok(1), rid, memberID(tok(2)), "hello")
	if err != nil || len(id) != 16 {
		t.Fatalf("id %q err %v", id, err)
	}
	got := notesIn(drain(cns[2]))
	if len(got) != 1 {
		t.Fatalf("recipient got %d notes", len(got))
	}
	d := got[0].data
	if d["id"] != id || d["roomId"] != rid || d["fromId"] != memberID(tok(1)) ||
		d["fromName"] != "Ada" || d["text"] != "hello" || d["sentAt"] != float64(h.nowMs()) {
		t.Fatalf("note data: %v", d)
	}
	if len(notesIn(drain(cns[1]))) != 0 || len(notesIn(drain(cns[3]))) != 0 {
		t.Fatal("note leaked to someone else")
	}
	// A guest can send to the host too.
	if _, err := h.SendNote(tok(2), rid, memberID(tok(1)), "hi"); err != nil {
		t.Fatal(err)
	}
	if len(notesIn(drain(cns[1]))) != 1 {
		t.Fatal("host did not get the note")
	}
}

func TestNoteErrors(t *testing.T) {
	h, _, rid, _ := noteSetup(t)
	outsider := tok(9)
	_, err := h.SendNote(outsider, rid, memberID(tok(2)), "x")
	wantStatus(t, err, 403)
	_, err = h.SendNote(tok(1), "nope", memberID(tok(2)), "x")
	wantStatus(t, err, 404)
	_, err = h.SendNote(tok(1), rid, memberID(tok(9)), "x") // not in room
	wantStatus(t, err, 404)
	_, err = h.SendNote(tok(1), rid, "nobody", "x")
	wantStatus(t, err, 404)
	_, err = h.SendNote(tok(1), rid, memberID(tok(1)), "x")
	wantStatus(t, err, 400)
}

func TestNoteRateLimit(t *testing.T) {
	h, clk, rid, _ := noteSetup(t)
	to := memberID(tok(2))
	for i := 0; i < 5; i++ {
		if _, err := h.SendNote(tok(1), rid, to, "n"); err != nil {
			t.Fatal(err)
		}
		clk.Advance(5 * time.Second)
	}
	_, err := h.SendNote(tok(1), rid, to, "n") // 25s after the first
	wantStatus(t, err, 429)
	// Another sender is unaffected.
	if _, err := h.SendNote(tok(3), rid, to, "n"); err != nil {
		t.Fatal(err)
	}
	clk.Advance(36 * time.Second) // 61s after the first note, 36s after the second
	if _, err := h.SendNote(tok(1), rid, to, "n"); err != nil {
		t.Fatalf("after window: %v", err)
	}
	_, err = h.SendNote(tok(1), rid, to, "n") // second is still inside the window
	wantStatus(t, err, 429)
}

func TestNoteQueuedWhileDisconnectedAndDeliveredOnce(t *testing.T) {
	h, _, rid, cns := noteSetup(t)
	h.Detach(cns[2])
	for i := 0; i < 3; i++ {
		if _, err := h.SendNote(tok(1), rid, memberID(tok(2)), fmt.Sprintf("m%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	cn, err := h.Connect(tok(2), "")
	if err != nil {
		t.Fatal(err)
	}
	evs := drain(cn)
	notes := notesIn(evs)
	if len(notes) != 3 || notes[0].data["text"] != "m0" || notes[2].data["text"] != "m2" {
		t.Fatalf("queued notes: %v", notes)
	}
	if evs[0].name != "rooms" || evs[1].name != "room" {
		t.Fatalf("notes must follow the state events: %v", evs[0].name)
	}
	h.Detach(cn)
	cn, _ = h.Connect(tok(2), "")
	if len(notesIn(drain(cn))) != 0 {
		t.Fatal("note delivered twice")
	}
}

func TestNoteQueueKeepsNewest20(t *testing.T) {
	h, clk, rid, cns := noteSetup(t)
	h.Detach(cns[2])
	for i := 0; i < 25; i++ {
		if i%5 == 0 {
			clk.Advance(time.Minute)
		}
		if _, err := h.SendNote(tok(1), rid, memberID(tok(2)), fmt.Sprintf("m%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	cn, _ := h.Connect(tok(2), "")
	notes := notesIn(drain(cn))
	if len(notes) != 20 || notes[0].data["text"] != "m5" || notes[19].data["text"] != "m24" {
		t.Fatalf("got %d notes, first %v", len(notes), notes[0].data["text"])
	}
}

func TestNoteQueueDroppedWhenRecipientLeaves(t *testing.T) {
	h, _, rid, cns := noteSetup(t)
	h.Detach(cns[2])
	if _, err := h.SendNote(tok(1), rid, memberID(tok(2)), "bye"); err != nil {
		t.Fatal(err)
	}
	if err := h.Leave(tok(2), rid); err != nil {
		t.Fatal(err)
	}
	cn, _ := h.Connect(tok(2), "")
	if len(notesIn(drain(cn))) != 0 {
		t.Fatal("note survived leaving")
	}
	// A member who has left cannot receive new notes.
	_, err := h.SendNote(tok(1), rid, memberID(tok(2)), "x")
	wantStatus(t, err, 404)
}

func TestNoteQueueDroppedWhenRoomRemoved(t *testing.T) {
	h, clk, rid, cns := noteSetup(t)
	h.Detach(cns[2])
	if _, err := h.SendNote(tok(1), rid, memberID(tok(2)), "x"); err != nil {
		t.Fatal(err)
	}
	clk.Advance(time.Hour) // finished? timer is paused at 0, so patch it to done
	h.mu.Lock()
	h.rooms[rid].timer.ElapsedMs = h.rooms[rid].timer.total()
	h.rooms[rid].setAt = h.now().Add(-time.Hour)
	h.mu.Unlock()
	h.Sweep()
	if _, ok := h.room(rid); ok {
		t.Fatal("room should be gone")
	}
	cn, _ := h.Connect(tok(2), "")
	if len(notesIn(drain(cn))) != 0 {
		t.Fatal("note survived room removal")
	}
}

// idleSetup makes a room hosted by tok(1) with a co-host tok(2) and a guest
// tok(3), all with open streams, and returns the room and the guest's stream.
func idleSetup(t *testing.T) (*hub, *fakeClock, Room, *conn) {
	t.Helper()
	h, clk := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(2), r.ID, "Bo")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(3), r.ID, "Cy")
	if _, err := h.SetRole(tok(1), r.ID, memberID(tok(2)), roleCohost); err != nil {
		t.Fatal(err)
	}
	h.Connect(tok(1), "")
	h.Connect(tok(2), "")
	guest, _ := h.Connect(tok(3), "")
	drain(guest)
	r, _ = h.room(r.ID)
	return h, clk, r, guest
}

func TestHostClearingTimerKeepsRoomAndMembers(t *testing.T) {
	h, _, before, guest := idleSetup(t)
	got, err := h.Patch(tok(1), before.ID, nil, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if got.Timer != nil || got.TimerRev != before.TimerRev+1 {
		t.Fatalf("timer = %+v rev %d, want nil rev %d", got.Timer, got.TimerRev, before.TimerRev+1)
	}
	if len(got.Members) != 3 || roleOf(got, tok(1)) != roleHost ||
		roleOf(got, tok(2)) != roleCohost || roleOf(got, tok(3)) != roleGuest {
		t.Fatalf("members = %+v", got.Members)
	}
	evs := drain(guest)
	ev := lastOf(evs, "room")
	if ev == nil {
		t.Fatal("guest got no room event")
	}
	room := ev.data["room"].(map[string]any)
	if room["id"] != before.ID || room["timer"] != nil {
		t.Fatalf("guest saw %+v", room)
	}
	list := lastOf(evs, "rooms").data["rooms"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["timer"] != nil {
		t.Fatalf("summary = %+v", list)
	}
}

func TestOnlyHostClearsOrStartsTimer(t *testing.T) {
	h, _, r, guest := idleSetup(t)
	tm := testTimer(h, true)
	// While a timer exists a co-host may replace it, but not clear it.
	if _, err := h.Patch(tok(2), r.ID, nil, &tm, false); err != nil {
		t.Fatal(err)
	}
	_, err := h.Patch(tok(2), r.ID, nil, nil, true)
	wantStatus(t, err, 403)
	_, err = h.Patch(tok(3), r.ID, nil, nil, true)
	wantStatus(t, err, 403)
	if _, err := h.Patch(tok(1), r.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	drain(guest)
	// With no timer only the host can order the next one; settings stay open to co-hosts.
	_, err = h.Patch(tok(2), r.ID, nil, &tm, false)
	wantStatus(t, err, 403)
	if len(drain(guest)) != 0 {
		t.Fatal("rejected patch produced events")
	}
	s := testSettings()
	s.DrinkID = "tea"
	if _, err := h.Patch(tok(2), r.ID, patchOf(s), nil, false); err != nil {
		t.Fatal(err)
	}
}

func TestHostStartingNextTimerUsesSameRoom(t *testing.T) {
	h, _, r, guest := idleSetup(t)
	if _, err := h.Patch(tok(1), r.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	drain(guest)
	tm := testTimer(h, true)
	got, err := h.Patch(tok(1), r.ID, nil, &tm, false)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != r.ID || got.Timer == nil || got.Timer.AnchorAt == nil || got.TimerRev != r.TimerRev+2 {
		t.Fatalf("room = %+v", got)
	}
	ev := lastOf(drain(guest), "room")
	if ev == nil || ev.data["room"].(map[string]any)["id"] != r.ID ||
		ev.data["room"].(map[string]any)["timer"] == nil {
		t.Fatalf("guest saw %+v", ev)
	}
	h.mu.Lock()
	n := len(h.rooms)
	h.mu.Unlock()
	if n != 1 {
		t.Fatalf("%d rooms, want 1", n)
	}
}

func TestIdleRoomExpiresAfterThirtyMinutes(t *testing.T) {
	h, clk, r, guest := idleSetup(t)
	if _, err := h.Patch(tok(1), r.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	// Settings changes do not keep an idle room alive.
	clk.Advance(10 * time.Minute)
	s := testSettings()
	if _, err := h.Patch(tok(1), r.ID, patchOf(s), nil, false); err != nil {
		t.Fatal(err)
	}
	clk.Advance(20*time.Minute - time.Second)
	h.Sweep()
	if _, ok := h.room(r.ID); !ok {
		t.Fatal("deleted too early")
	}
	drain(guest)
	clk.Advance(time.Second)
	h.Sweep()
	if _, ok := h.room(r.ID); ok {
		t.Fatal("idle room survived")
	}
	ev := lastOf(drain(guest), "room")
	if ev == nil || ev.data["room"] != nil {
		t.Fatalf("want room null, got %+v", ev)
	}
}

func TestStartingTimerResetsIdleExpiry(t *testing.T) {
	h, clk, r, _ := idleSetup(t)
	if _, err := h.Patch(tok(1), r.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	clk.Advance(29 * time.Minute)
	tm := testTimer(h, false) // paused at 0, so the finished rule does not apply either
	if _, err := h.Patch(tok(1), r.ID, nil, &tm, false); err != nil {
		t.Fatal(err)
	}
	clk.Advance(time.Hour)
	h.Sweep()
	if _, ok := h.room(r.ID); !ok {
		t.Fatal("room with a timer was removed by the idle rule")
	}
}

func TestHostLeavingIdleRoomStillPromotes(t *testing.T) {
	h, _, r, _ := idleSetup(t)
	if _, err := h.Patch(tok(1), r.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	// The host joins someone else's timer, which leaves this room.
	other := mustCreate(t, h, tok(9), "Zed")
	mustJoin(t, h, tok(1), other.ID, "Ada")
	got, ok := h.room(r.ID)
	if !ok || len(got.Members) != 2 || roleOf(got, tok(2)) != roleHost || got.Timer != nil {
		t.Fatalf("room = %+v (ok %v)", got, ok)
	}
	// The promoted host can order the next timer.
	tm := testTimer(h, true)
	if _, err := h.Patch(tok(2), r.ID, nil, &tm, false); err != nil {
		t.Fatal(err)
	}
}

func mixOf(id, name string, v float64) SavedMix {
	return SavedMix{ID: id, Name: name, Mix: map[string]float64{"rain": v}}
}

func settingsWithMixes(ms ...SavedMix) *Settings {
	s := testSettings()
	s.Mixes = ms
	return &s
}

func TestValidateMixes(t *testing.T) {
	ok := func(ms []SavedMix) error { _, err := validateSettings(*settingsWithMixes(ms...)); return err }
	if err := ok([]SavedMix{mixOf("a", "A", 0.5)}); err != nil {
		t.Fatal(err)
	}
	many := make([]SavedMix, 41)
	for i := range many {
		many[i] = mixOf(fmt.Sprint("m", i), "x", 0.1)
	}
	bad := map[string][]SavedMix{
		"41 mixes":   many,
		"empty id":   {mixOf("", "A", 0.5)},
		"long id":    {mixOf(strings.Repeat("i", 41), "A", 0.5)},
		"dup id":     {mixOf("a", "A", 0.5), mixOf("a", "B", 0.5)},
		"empty name": {mixOf("a", "", 0.5)},
		"long name":  {mixOf("a", strings.Repeat("n", 31), 0.5)},
		"volume":     {mixOf("a", "A", 1.5)},
		"too many keys": {{ID: "a", Name: "A", Mix: func() map[string]float64 {
			m := map[string]float64{}
			for i := 0; i < 17; i++ {
				m[fmt.Sprint("c", i)] = 0.1
			}
			return m
		}()}},
	}
	for name, ms := range bad {
		wantStatus(t, ok(ms), 400)
		_ = name
	}
	if err := ok(many[:40]); err != nil {
		t.Fatalf("40 mixes: %v", err)
	}
}

func TestMixesInRoom(t *testing.T) {
	h, _ := newTestHub()
	host, co, guest := tok(1), tok(2), tok(3)
	base := mixOf("a", "Alpha", 0.5)
	r, err := h.CreateRoom(host, "Ada", *settingsWithMixes(base), testTimer(h, false))
	if err != nil {
		t.Fatal(err)
	}
	mustJoin(t, h, co, r.ID, "Bo")
	mustJoin(t, h, guest, r.ID, "Cy")
	if _, err := h.SetRole(host, r.ID, memberID(co), roleCohost); err != nil {
		t.Fatal(err)
	}
	patch := func(token string, ms ...SavedMix) (Room, error) {
		s := settingsWithMixes(ms...)
		v, err := validateSettings(*s)
		if err != nil {
			return Room{}, err
		}
		return h.Patch(token, r.ID, patchOf(v), nil, false)
	}
	extra := mixOf("b", "Study", 0.3)

	// A co-host may append, and only append.
	got, err := patch(co, base, extra)
	if err != nil || len(got.Settings.Mixes) != 2 {
		t.Fatalf("append: %v %+v", err, got.Settings.Mixes)
	}
	for name, ms := range map[string][]SavedMix{
		"remove":  {extra},
		"rename":  {mixOf("a", "Renamed", 0.5), extra},
		"change":  {mixOf("a", "Alpha", 0.9), extra},
		"reorder": {extra, base},
		"empty":   {},
	} {
		if _, err := patch(co, ms...); err == nil {
			t.Fatalf("%s accepted", name)
		} else {
			wantStatus(t, err, 403)
		}
	}
	_, err = patch(guest, base, extra)
	wantStatus(t, err, 403)
	if cur, _ := h.room(r.ID); len(cur.Settings.Mixes) != 2 {
		t.Fatalf("rejected patches changed the list: %+v", cur.Settings.Mixes)
	}

	// A patch without mixes keeps the list, for the host and a co-host.
	noMixes := testSettings()
	noMixes.DrinkID = "mocha"
	for _, token := range []string{co, host} {
		got, err = h.Patch(token, r.ID, patchOf(noMixes), nil, false)
		if err != nil || got.Settings.DrinkID != "mocha" || len(got.Settings.Mixes) != 2 {
			t.Fatalf("no mixes: %v %+v", err, got.Settings)
		}
	}

	// The host edits freely.
	got, err = patch(host, mixOf("a", "Renamed", 0.2))
	if err != nil || len(got.Settings.Mixes) != 1 || got.Settings.Mixes[0].Name != "Renamed" {
		t.Fatalf("host edit: %v %+v", err, got.Settings.Mixes)
	}
	got, err = patch(host, []SavedMix{}...)
	if err != nil || got.Settings.Mixes == nil || len(got.Settings.Mixes) != 0 {
		t.Fatalf("host clear: %v %#v", err, got.Settings.Mixes)
	}
}

func TestRoomViewMixesNeverNull(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	raw, _ := json.Marshal(r)
	if !strings.Contains(string(raw), `"mixes":[]`) {
		t.Fatalf("view = %s", raw)
	}
}

// --- account handover ---

func namesOf(evs []event) []string {
	out := make([]string, len(evs))
	for i, e := range evs {
		out[i] = e.name
	}
	return out
}

func memberAt(t *testing.T, r Room, id string) (int, Member) {
	t.Helper()
	for i, m := range r.Members {
		if m.ID == id {
			return i, m
		}
	}
	t.Fatalf("no member %s in %+v", id, r.Members)
	return -1, Member{}
}

func TestHandoverKeepsRoleNameAndPlace(t *testing.T) {
	hal, ada, gus, bee := tok(1), tok(2), tok(3), tok(4)
	for _, role := range []string{roleHost, roleCohost, roleGuest} {
		t.Run(role, func(t *testing.T) {
			h, clk := newTestHub()
			ca, _ := h.Connect(ada, "Ada phone")
			cg, _ := h.Connect(gus, "Gus")
			cb, _ := h.Connect(bee, "Ada laptop")
			var id string
			if role == roleHost {
				id = mustCreate(t, h, ada, "Ada").ID
			} else {
				id = mustCreate(t, h, hal, "Hal").ID
				clk.Advance(time.Second)
				mustJoin(t, h, ada, id, "Ada")
				if role == roleCohost {
					if _, err := h.SetRole(hal, id, memberID(ada), roleCohost); err != nil {
						t.Fatal(err)
					}
				}
			}
			clk.Advance(time.Second)
			mustJoin(t, h, gus, id, "Gus")
			tm := testTimer(h, true)
			if _, err := h.Patch(memberOrHost(role, ada, hal), id, nil, &tm, false); err != nil {
				t.Fatal(err)
			}
			h.ClaimAccount("Ada", 1, ada, false)
			before, _ := h.room(id)
			drain(ca)
			drain(cg)
			drain(cb)
			clk.Advance(time.Second)

			h.ClaimAccount("ADA", 2, bee, true) // usernames ignore case

			evA := drain(ca)
			wantFrame := "event: session\ndata: {\"now\":" + fmt.Sprint(h.nowMs()) + ",\"state\":\"revoked\"}\n\n"
			if len(evA) < 2 || evA[0].raw != wantFrame {
				t.Fatalf("old device events %v, want %q first", evA, wantFrame)
			}
			after, _ := h.room(id)
			if after.TimerRev != before.TimerRev || !reflect.DeepEqual(after.Timer, before.Timer) {
				t.Fatalf("timer changed: %+v rev %d -> %+v rev %d", before.Timer, before.TimerRev, after.Timer, after.TimerRev)
			}
			if len(after.Members) != len(before.Members)+1 {
				t.Fatalf("members %+v -> %+v", before.Members, after.Members)
			}
			i, was := memberAt(t, before, memberID(ada))
			now := after.Members[i]
			if now.ID != memberID(bee) || now.Name != was.Name || now.Role != role || now.JoinedAt != was.JoinedAt {
				t.Fatalf("slot %d: %+v, want %+v bound to the new device", i, now, was)
			}
			for j, m := range before.Members {
				if j != i && after.Members[j] != m {
					t.Fatalf("member %d changed: %+v -> %+v", j, m, after.Members[j])
				}
			}
			last := after.Members[len(after.Members)-1]
			if last != (Member{ID: memberID(ada), Name: "Ada phone", Role: roleGuest, JoinedAt: h.nowMs()}) {
				t.Fatalf("old device: %+v", last)
			}
			// Every device's next view agrees; only the old device hears "session".
			for name, cn := range map[string]*conn{"old": ca, "guest": cg, "new": cb} {
				evs := evA
				if cn != ca {
					evs = drain(cn)
					if lastOf(evs, "session") != nil {
						t.Fatalf("%s device got a session event", name)
					}
				}
				ev := lastOf(evs, "room")
				if ev == nil {
					t.Fatalf("%s device: no room event", name)
				}
				ms := sub(ev.data, "room")["members"].([]any)
				if m := ms[i].(map[string]any); m["id"] != memberID(bee) || m["name"] != was.Name || m["role"] != role {
					t.Fatalf("%s device sees %v", name, m)
				}
			}
		})
	}
}

// memberOrHost picks who can patch the timer for the role case.
func memberOrHost(role, member, host string) string {
	if role == roleHost {
		return member
	}
	return host
}

func TestHandoverMovesNewDeviceOutOfItsOwnRoom(t *testing.T) {
	ada, bee, xan := tok(1), tok(2), tok(3)
	cases := []struct {
		name  string
		setup func(t *testing.T, h *hub, adaRoom string) (beeRoom string)
	}{
		{"alone in its own room", func(t *testing.T, h *hub, _ string) string {
			return mustCreate(t, h, bee, "Bee").ID
		}},
		{"hosting a guest", func(t *testing.T, h *hub, _ string) string {
			id := mustCreate(t, h, bee, "Bee").ID
			mustJoin(t, h, xan, id, "Xan")
			return id
		}},
		{"a guest in the same room", func(t *testing.T, h *hub, adaRoom string) string {
			mustJoin(t, h, bee, adaRoom, "Bee")
			return adaRoom
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h, clk := newTestHub()
			id := mustCreate(t, h, ada, "Ada").ID
			clk.Advance(time.Second)
			beeRoom := c.setup(t, h, id)
			h.ClaimAccount("ada", 1, ada, false)
			h.ClaimAccount("ada", 2, bee, true)

			got, _ := h.room(id)
			if _, m := memberAt(t, got, memberID(bee)); m.Role != roleHost || m.Name != "Ada" {
				t.Fatalf("new device: %+v", m)
			}
			if _, m := memberAt(t, got, memberID(ada)); m.Role != roleGuest {
				t.Fatalf("old device: %+v", m)
			}
			if len(got.Members) != 2 {
				t.Fatalf("members %+v", got.Members)
			}
			if beeRoom == id {
				return
			}
			old, ok := h.room(beeRoom)
			switch c.name {
			case "alone in its own room":
				if ok {
					t.Fatalf("emptied room still exists: %+v", old)
				}
			default:
				if !ok || len(old.Members) != 1 || roleOf(old, xan) != roleHost {
					t.Fatalf("left room: %+v", old)
				}
			}
		})
	}
}

func TestHandoverIntoFullRoomDropsOldDevice(t *testing.T) {
	h, _ := newTestHub()
	ada, bee := tok(1), tok(2)
	id := mustCreate(t, h, ada, "Ada").ID
	for i := 1; i < maxMembers; i++ {
		mustJoin(t, h, tok(100+i), id, "Guest")
	}
	h.ClaimAccount("ada", 1, ada, false)
	h.ClaimAccount("ada", 2, bee, true)
	got, _ := h.room(id)
	if len(got.Members) != maxMembers || roleOf(got, bee) != roleHost || roleOf(got, ada) != "" {
		t.Fatalf("members %+v", got.Members)
	}
}

// Claims that do not move the link to a newer session on another device
// change nothing and send nothing.
func TestClaimIgnoresSameDeviceAndStaleSessions(t *testing.T) {
	h, _ := newTestHub()
	ada, bee, cy := tok(1), tok(2), tok(3)
	id := mustCreate(t, h, ada, "Ada").ID
	ca, _ := h.Connect(ada, "")
	cb, _ := h.Connect(bee, "")
	cc, _ := h.Connect(cy, "")

	h.ClaimAccount("ada", 1, ada, false)
	h.ClaimAccount("ada", 2, ada, true) // new session, same device
	if evs := drain(ca); len(evs) != 2 || lastOf(evs, "session") != nil {
		t.Fatalf("same-device claim sent %v", namesOf(evs)) // just the connect frames
	}

	// The store granted gen 3 to bee (replacing ada) and then gen 4 to cy
	// (replacing bee), but the hub hears cy first: cy takes over from ada,
	// the device the hub links, and bee's late claim must not take it back.
	drain(ca)
	h.ClaimAccount("ada", 4, cy, true)
	if lastOf(drain(ca), "session") == nil {
		t.Fatal("ada was not told its session ended")
	}
	drain(cb)
	h.ClaimAccount("ada", 3, bee, true)
	got, _ := h.room(id)
	if roleOf(got, cy) != roleHost || roleOf(got, bee) != "" || roleOf(got, ada) != roleGuest {
		t.Fatalf("members %+v", got.Members)
	}
	if evs := drain(cb); len(evs) != 0 {
		t.Fatalf("stale claim sent %v to its device", namesOf(evs))
	}
	if evs := drain(cc); lastOf(evs, "session") != nil {
		t.Fatalf("winner got %v", namesOf(evs))
	}
}

func TestReleaseAccountOnlyByLinkedDevice(t *testing.T) {
	h, _ := newTestHub()
	ada, bee, cy := tok(1), tok(2), tok(3)
	id := mustCreate(t, h, ada, "Ada").ID
	ca, _ := h.Connect(ada, "")
	h.ClaimAccount("ada", 1, ada, false)

	h.ReleaseAccount("ada", bee) // not the linked device: kept
	h.ClaimAccount("ada", 2, bee, true)
	if lastOf(drain(ca), "session") == nil {
		t.Fatal("release by another device dropped the link")
	}

	cb, _ := h.Connect(bee, "")
	drain(cb)
	h.ReleaseAccount("ADA", bee) // logout on the linked device
	h.ClaimAccount("ada", 3, cy, true)
	got, _ := h.room(id)
	if roleOf(got, bee) != roleHost || roleOf(got, cy) != "" {
		t.Fatalf("claim after release moved the room: %+v", got.Members)
	}
	if evs := drain(cb); len(evs) != 0 {
		t.Fatalf("released device got %v", namesOf(evs))
	}
}

// A login that did not replace a live session (the linked device had logged
// out or expired, its release not yet heard) moves the link but leaves that
// device alone.
func TestClaimWithoutReplacedSessionLeavesOldDevice(t *testing.T) {
	h, _ := newTestHub()
	ada, bee, cy := tok(1), tok(2), tok(3)
	id := mustCreate(t, h, ada, "Ada").ID
	ca, _ := h.Connect(ada, "")
	h.ClaimAccount("ada", 1, ada, false)
	drain(ca)

	h.ClaimAccount("ada", 2, bee, false)
	h.ClaimAccount("ada", 3, cy, true) // replaces bee, not ada
	if evs := drain(ca); len(evs) != 0 {
		t.Fatalf("logged-out device got %v", namesOf(evs))
	}
	got, _ := h.room(id)
	if len(got.Members) != 1 || roleOf(got, ada) != roleHost {
		t.Fatalf("members %+v", got.Members)
	}
}

// --- host succession ---

// succRoom makes host tok(1) with guests tok(2) "A" and tok(3) "B" joined in
// that order, a second apart.
func succRoom(t *testing.T) (*hub, *fakeClock, Room) {
	t.Helper()
	h, clk := newTestHub()
	r := mustCreate(t, h, tok(1), "H")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(2), r.ID, "A")
	clk.Advance(time.Second)
	mustJoin(t, h, tok(3), r.ID, "B")
	clk.Advance(time.Second)
	return h, clk, r
}

func setRole(t *testing.T, h *hub, clk *fakeClock, roomID, host, target, role string) {
	t.Helper()
	if _, err := h.SetRole(host, roomID, memberID(target), role); err != nil {
		t.Fatal(err)
	}
	clk.Advance(time.Second)
}

func order(r Room) []string {
	out := make([]string, len(r.Members))
	for i, m := range r.Members {
		out[i] = m.Name
	}
	return out
}

func wantOrder(t *testing.T, r Room, want ...string) {
	t.Helper()
	if got := order(r); !reflect.DeepEqual(got, want) {
		t.Fatalf("members in order %v, want %v", got, want)
	}
}

func TestSuccessionFollowsPromotionOrder(t *testing.T) {
	h, clk, r := succRoom(t)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	got, _ := h.room(r.ID)
	wantOrder(t, got, "H", "B", "A")
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = h.room(r.ID)
	wantOrder(t, got, "B", "A")
	if roleOf(got, tok(3)) != roleHost || roleOf(got, tok(2)) != roleCohost {
		t.Fatalf("members = %+v", got.Members)
	}
	if got.Members[0].PromotedAt != 0 {
		t.Fatalf("new host still has promotedAt: %+v", got.Members[0])
	}
}

func TestSuccessionRepromotedGoesToBack(t *testing.T) {
	h, clk, r := succRoom(t)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleGuest)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	got, _ := h.room(r.ID)
	wantOrder(t, got, "H", "A", "B")
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = h.room(r.ID)
	if roleOf(got, tok(2)) != roleHost || roleOf(got, tok(3)) != roleCohost {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestSuccessionSamePromotionTimestamp(t *testing.T) {
	h, _, r := succRoom(t) // the clock does not move between the promotions
	for _, n := range []int{3, 2} {
		if _, err := h.SetRole(tok(1), r.ID, memberID(tok(n)), roleCohost); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := h.room(r.ID)
	if roleOf(got, tok(3)) != roleHost {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestSuccessionNoCohostsUsesJoinOrder(t *testing.T) {
	h, _, r := succRoom(t)
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ := h.room(r.ID)
	wantOrder(t, got, "A", "B")
	if roleOf(got, tok(2)) != roleHost {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestSuccessionDemotedCohostKeepsJoinPosition(t *testing.T) {
	h, clk, r := succRoom(t)
	clk.Advance(time.Second)
	mustJoin(t, h, tok(4), r.ID, "C")
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleGuest) // B is a guest again
	setRole(t, h, clk, r.ID, tok(1), tok(4), roleCohost)
	got, _ := h.room(r.ID)
	wantOrder(t, got, "H", "C", "A", "B")
	if m := got.Members[3]; m.Role != roleGuest || m.PromotedAt != 0 {
		t.Fatalf("demoted member = %+v", m)
	}
	// With C gone as well, the guest queue is in join order: A before B.
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	if err := h.Leave(tok(4), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = h.room(r.ID)
	wantOrder(t, got, "A", "B")
	if roleOf(got, tok(2)) != roleHost {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestPromoteExistingCohostKeepsPlace(t *testing.T) {
	h, clk, r := succRoom(t)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	before, _ := h.room(r.ID)
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	after, _ := h.room(r.ID)
	if !reflect.DeepEqual(before.Members, after.Members) {
		t.Fatalf("members %+v -> %+v", before.Members, after.Members)
	}
}

func TestViewListsSuccessionOrder(t *testing.T) {
	h, clk, r := succRoom(t)
	cn, _ := h.Connect(tok(3), "")
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	promoted := h.nowMs() - 1000
	got, _ := h.room(r.ID)
	wantOrder(t, got, "H", "B", "A")
	for _, m := range got.Members {
		if (m.Role == roleCohost) != (m.PromotedAt != 0) {
			t.Fatalf("promotedAt on %+v", m)
		}
	}
	if got.Members[1].PromotedAt != promoted {
		t.Fatalf("promotedAt = %d, want %d", got.Members[1].PromotedAt, promoted)
	}
	ev := lastOf(drain(cn), "room")
	if ev == nil {
		t.Fatal("no room event")
	}
	ms := sub(ev.data, "room")["members"].([]any)
	var names []string
	for _, m := range ms {
		names = append(names, m.(map[string]any)["name"].(string))
	}
	if !reflect.DeepEqual(names, []string{"H", "B", "A"}) {
		t.Fatalf("event order %v", names)
	}
	host := ms[0].(map[string]any)
	if _, ok := host["promotedAt"]; ok {
		t.Fatalf("host has promotedAt: %v", host)
	}
}

func TestSuccessionAfterGraceRemoval(t *testing.T) {
	h, clk, r := succRoom(t)
	cn, _ := h.Connect(tok(1), "")
	h.Connect(tok(2), "")
	h.Connect(tok(3), "")
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	h.Detach(cn)
	clk.Advance(time.Minute)
	h.Sweep()
	got, _ := h.room(r.ID)
	wantOrder(t, got, "B", "A")
	if roleOf(got, tok(3)) != roleHost {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestHandoverKeepsPromotionOrder(t *testing.T) {
	h, clk, r := succRoom(t)
	ca, _ := h.Connect(tok(3), "B phone")
	h.Connect(tok(2), "A")
	h.Connect(tok(5), "B laptop")
	setRole(t, h, clk, r.ID, tok(1), tok(3), roleCohost)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	drain(ca)
	before, _ := h.room(r.ID)
	h.ClaimAccount("Bee", 1, tok(3), false)
	h.ClaimAccount("Bee", 2, tok(5), true)
	got, _ := h.room(r.ID)
	if got.Members[1].ID != memberID(tok(5)) || got.Members[1].PromotedAt != before.Members[1].PromotedAt {
		t.Fatalf("members %+v, was %+v", got.Members, before.Members)
	}
	wantOrder(t, got, "H", "B", "A", "B phone")
	if err := h.Leave(tok(1), r.ID); err != nil {
		t.Fatal(err)
	}
	got, _ = h.room(r.ID)
	if roleOf(got, tok(5)) != roleHost || roleOf(got, tok(2)) != roleCohost {
		t.Fatalf("members = %+v", got.Members)
	}
}
