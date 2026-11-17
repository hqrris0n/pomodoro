package main

import (
	"encoding/json"
	"fmt"
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

func TestCreateMakesCreatorSoleOwnerAndAnnouncesIt(t *testing.T) {
	h, _ := newTestHub()
	watcher, _ := h.Connect(tok(9), "")
	drain(watcher)

	r := mustCreate(t, h, tok(1), "Ada")
	if len(r.Members) != 1 || r.Members[0].Role != roleOwner || r.Members[0].Name != "Ada" {
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

func TestJoinAsVisitorAndSwitchRooms(t *testing.T) {
	h, _ := newTestHub()
	a := mustCreate(t, h, tok(1), "Ada")
	b := mustCreate(t, h, tok(2), "Bo")
	mustJoin(t, h, tok(3), a.ID, "Cy")
	got, _ := h.room(a.ID)
	if roleOf(got, tok(3)) != roleVisitor {
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
	_, err := h.Patch(tok(2), r.ID, nil, &newTimer)
	wantStatus(t, err, 403)
	if got, _ := h.room(r.ID); got.Timer.AnchorAt != nil {
		t.Fatal("visitor changed state")
	}
	if len(drain(visitor)) != 0 {
		t.Fatal("rejected patch produced events")
	}

	if _, err := h.Patch(tok(1), r.ID, nil, &newTimer); err != nil {
		t.Fatal(err)
	}
	ev := lastOf(drain(visitor), "room")
	if ev == nil || ev.data["room"].(map[string]any)["timer"].(map[string]any)["anchorAt"] == nil {
		t.Fatalf("visitor did not see the new timer: %+v", ev)
	}
}

func TestPromote(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	mustJoin(t, h, tok(2), r.ID, "Bo")
	mustJoin(t, h, tok(3), r.ID, "Cy")

	_, err := h.Promote(tok(2), r.ID, memberID(tok(3)))
	wantStatus(t, err, 403)
	// An unknown member id is 404: the room exists but that member does not.
	_, err = h.Promote(tok(1), r.ID, "nobody00000")
	wantStatus(t, err, 404)

	got, err := h.Promote(tok(1), r.ID, memberID(tok(2)))
	if err != nil {
		t.Fatal(err)
	}
	if roleOf(got, tok(2)) != roleOwner || roleOf(got, tok(1)) != roleOwner || roleOf(got, tok(3)) != roleVisitor {
		t.Fatalf("members = %+v", got.Members)
	}
}

func TestOwnerLeavingPassesOwnershipToEarliestJoiner(t *testing.T) {
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
	if roleOf(after, tok(2)) != roleOwner || roleOf(after, tok(3)) != roleVisitor {
		t.Fatalf("members = %+v", after.Members)
	}
	if after.Timer != before.Timer {
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
	if len(got.Members) != 1 || roleOf(got, tok(2)) != roleOwner {
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
	if _, err := h.Promote(a, r.ID, memberID(b)); err != nil {
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
