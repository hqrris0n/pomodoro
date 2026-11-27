package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Join-versus-close races. Every hub command runs under hub.mu, so a join
// that meets a closing room either runs first (the joiner is promoted to host
// and, if the close was a sweep or leave, the room survives or is removed
// right after) or runs second and gets 404 "no such room". These tests pin
// that down for the three ways a room closes: its last member leaves, the
// last member's grace period runs out, and the janitor deletes a finished room.
//
// The host side (create, connect, detach) is driven through hub methods
// directly; the racing calls (join, leave) go over HTTP; Sweep is called on
// the hub because the janitor goroutine is not running under test. Each
// repetition is a subtest, so its stream is closed before the next one.

// newRaceServerClock is newRaceServer that also returns the fake clock.
func newRaceServerClock(t *testing.T) (*httptest.Server, *hub, *fakeClock) {
	t.Helper()
	static := t.TempDir()
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h, clk := newTestHub()
	ps := openProfilesIter(filepath.Join(t.TempDir(), "data"), clk.Now, t.Logf, testPBKDF2Iter)
	srv := httptest.NewServer(newHandler(h, ps, static, testOpts))
	t.Cleanup(srv.Close)
	t.Cleanup(h.CloseStreams)
	return srv, h, clk
}

// hubRoom is a snapshot of one room's members, taken under the hub lock.
type hubRoom struct {
	id    string
	roles []string
	names []string
}

func hubRooms(h *hub) []hubRoom {
	h.mu.Lock()
	defer h.mu.Unlock()
	var out []hubRoom
	for _, r := range h.rooms {
		hr := hubRoom{id: r.id}
		for _, m := range r.members {
			hr.roles = append(hr.roles, m.role)
			hr.names = append(hr.names, m.name)
		}
		out = append(out, hr)
	}
	return out
}

// clientRoom returns the room id the hub has recorded for token.
func clientRoom(h *hub, token string) string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c := h.clients[token]; c != nil {
		return c.roomID
	}
	return ""
}

// joinFixture is one repetition: host H connected and alone in a room, and
// guest G with a stream open and in no room.
type joinFixture struct {
	roomID string
	hTok   string
	gTok   string
	hConn  *conn
	g      *raceStream
}

func newJoinFixture(t *testing.T, srv *httptest.Server, h *hub, base, rep int, running bool) joinFixture {
	t.Helper()
	f := joinFixture{hTok: tok(base + rep*2), gTok: tok(base + rep*2 + 1)}
	var err error
	if f.hConn, err = h.Connect(f.hTok, "Hana"); err != nil {
		t.Fatalf("connect H: %v", err)
	}
	room, err := h.CreateRoom(f.hTok, "", testSettings(), testTimer(h, running))
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	f.roomID = room.ID
	f.g = openStream(t, srv, f.gTok, "Gus")
	return f
}

func (f joinFixture) join(srv *httptest.Server) raceResp {
	return fire(srv, "POST", "/api/rooms/"+f.roomID+"/join", `{"name":"Gus"}`, f.gTok, "")
}

// checkJoined asserts the state after a 200 join where the room must still
// exist: exactly G, as host, in the hub and on G's stream.
func (f joinFixture) checkJoined(t *testing.T, h *hub) {
	t.Helper()
	rooms := hubRooms(h)
	if len(rooms) != 1 || rooms[0].id != f.roomID || len(rooms[0].roles) != 1 ||
		rooms[0].roles[0] != roleHost || rooms[0].names[0] != "Gus" {
		t.Fatalf("join 200, but hub rooms = %+v, want only %s with exactly Gus as host", rooms, f.roomID)
	}
	if got := clientRoom(h, f.gTok); got != f.roomID {
		t.Fatalf("join 200, but G's room in hub = %q, want %s", got, f.roomID)
	}
	got := f.g.waitRoom(func(r *Room) bool { return r != nil && r.ID == f.roomID && len(r.Members) == 1 }, 5*time.Second)
	_, you := f.g.lastRoom()
	if m := got.Members[0]; m.ID != you || m.Role != roleHost {
		t.Fatalf("join 200, but G's stream shows member %+v (you %q), want G as host", m, you)
	}
}

// checkGone asserts the room no longer exists and G is in no room, in the hub
// and on G's stream.
func (f joinFixture) checkGone(t *testing.T, h *hub, why string) {
	t.Helper()
	if rooms := hubRooms(h); len(rooms) != 0 {
		t.Fatalf("%s, but hub still has rooms %+v", why, rooms)
	}
	if got := clientRoom(h, f.gTok); got != "" {
		t.Fatalf("%s, but G's room in hub = %q, want none", why, got)
	}
	f.g.waitRoom(func(r *Room) bool { return r == nil }, 5*time.Second)
}

// spin delays the sweep by a rep-dependent 0-360us. A Sweep call is one
// in-process lock acquisition and would otherwise always beat an HTTP join,
// so only the "sweep first" order would ever be exercised.
func spin(rep int) {
	for start := time.Now(); time.Since(start) < time.Duration(rep%10)*40*time.Microsecond; {
	}
}

// Join while the last member leaves.
func TestJoinRacesLastMemberLeaving(t *testing.T) {
	srv, h, _ := newRaceServerClock(t)
	var joined, refused int
	for rep := range repeatCount() {
		t.Run(fmt.Sprintf("rep%d", rep), func(t *testing.T) {
			f := newJoinFixture(t, srv, h, 1_000_000, rep, false)
			res := race(2, func(i int) raceResp {
				if i == 0 {
					return fire(srv, "POST", "/api/rooms/"+f.roomID+"/leave", "", f.hTok, "")
				}
				return f.join(srv)
			})
			leave, join := res[0], res[1]
			if leave.Err != nil || leave.Status != http.StatusOK {
				t.Fatalf("rep %d: H's leave = %d %v %s, want 200", rep, leave.Status, leave.Err, leave.Body)
			}
			switch {
			case join.Err == nil && join.Status == http.StatusOK:
				joined++
				f.checkJoined(t, h)
				if err := h.Leave(f.gTok, f.roomID); err != nil { // free the room slot
					t.Fatalf("rep %d: G leave: %v", rep, err)
				}
			case join.Err == nil && join.Status == http.StatusNotFound:
				refused++
				f.checkGone(t, h, "join 404")
			default:
				t.Fatalf("rep %d: join = %d %v %s, want 200 or 404", rep, join.Status, join.Err, join.Body)
			}
		})
	}
	t.Logf("join first (200, promoted to host): %d, leave first (404): %d", joined, refused)
}

// Join while the last member's grace period expires.
func TestJoinRacesGraceExpiry(t *testing.T) {
	srv, h, clk := newRaceServerClock(t)
	var joined, refused int
	for rep := range repeatCount() {
		t.Run(fmt.Sprintf("rep%d", rep), func(t *testing.T) {
			f := newJoinFixture(t, srv, h, 2_000_000, rep, false)
			h.Detach(f.hConn)
			clk.Advance(gracePeriod + time.Second)
			res := race(2, func(i int) raceResp {
				if i == 0 {
					spin(rep)
					h.Sweep()
					return raceResp{}
				}
				return f.join(srv)
			})
			join := res[1]
			switch {
			case join.Err == nil && join.Status == http.StatusOK:
				// Join ran first: G is a guest, then Sweep removes H and promotes G.
				joined++
				f.checkJoined(t, h)
				if err := h.Leave(f.gTok, f.roomID); err != nil {
					t.Fatalf("rep %d: G leave: %v", rep, err)
				}
			case join.Err == nil && join.Status == http.StatusNotFound:
				refused++
				f.checkGone(t, h, "join 404")
			default:
				t.Fatalf("rep %d: join = %d %v %s, want 200 or 404", rep, join.Status, join.Err, join.Body)
			}
		})
	}
	t.Logf("join first (200, G host of surviving room): %d, sweep first (404): %d", joined, refused)
}

// Join while the janitor deletes a room whose timer finished over ten minutes ago.
func TestJoinRacesFinishedRoomSweep(t *testing.T) {
	srv, h, clk := newRaceServerClock(t)
	var joined, refused int
	for rep := range repeatCount() {
		t.Run(fmt.Sprintf("rep%d", rep), func(t *testing.T) {
			f := newJoinFixture(t, srv, h, 3_000_000, rep, true)
			clk.Advance(time.Duration(testTimer(h, true).total())*time.Millisecond + finishedRoomTTL + time.Second)
			res := race(2, func(i int) raceResp {
				if i == 0 {
					spin(rep)
					h.Sweep()
					return raceResp{}
				}
				return f.join(srv)
			})
			join := res[1]
			switch {
			case join.Err == nil && join.Status == http.StatusOK:
				joined++
				f.checkGone(t, h, "join 200 (joined before the sweep)")
			case join.Err == nil && join.Status == http.StatusNotFound:
				refused++
				f.checkGone(t, h, "join 404 (sweep first)")
			default:
				t.Fatalf("rep %d: join = %d %v %s, want 200 or 404", rep, join.Status, join.Err, join.Body)
			}
		})
	}
	t.Logf("join first (200, then swept): %d, sweep first (404): %d", joined, refused)
}
