package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Races between timer commands and between a command and a restart. Each
// repetition uses fresh tokens (20 requests per 10 s per token).

type tcFixture struct {
	roomID          string
	host, co, guest string
	hs, cs, gs      *raceStream
	rev             uint64
}

// newTCFixture makes a room with a running timer, a co-host and a guest.
func newTCFixture(t *testing.T, srv *httptest.Server, it int) tcFixture {
	t.Helper()
	base := 300000 + it*10
	f := tcFixture{host: tok(base), co: tok(base + 1), guest: tok(base + 2)}
	f.hs = openStream(t, srv, f.host, "h")
	f.cs = openStream(t, srv, f.co, "c")
	f.gs = openStream(t, srv, f.guest, "g")
	body, _ := json.Marshal(createBody(func(m map[string]any) { sub(m, "timer")["anchorAt"] = 1 }))
	c := fire(srv, "POST", "/api/rooms", string(body), f.host, "")
	var room Room
	if c.Status != http.StatusOK || json.Unmarshal([]byte(c.Body), &room) != nil {
		t.Fatalf("iter %d create: %d %s", it, c.Status, c.Body)
	}
	f.roomID, f.rev = room.ID, room.TimerRev
	for _, tk := range []string{f.co, f.guest} {
		if r := fire(srv, "POST", "/api/rooms/"+room.ID+"/join", `{"name":"x"}`, tk, ""); r.Status != http.StatusOK {
			t.Fatalf("iter %d join: %d %s", it, r.Status, r.Body)
		}
	}
	in := `{"memberId":"` + memberID(f.co) + `","role":"cohost"}`
	if r := fire(srv, "POST", "/api/rooms/"+room.ID+"/role", in, f.host, ""); r.Status != http.StatusOK {
		t.Fatalf("iter %d promote: %d %s", it, r.Status, r.Body)
	}
	f.cs.waitRoom(func(r *Room) bool { return r != nil && roleOf(*r, f.co) == roleCohost }, 5*time.Second)
	return f
}

func tcBody(action string, rev uint64) string {
	b, _ := json.Marshal(map[string]any{"action": action, "rev": rev})
	return string(b)
}

func TestTimerCmdRacePauseTwice(t *testing.T) {
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		f := newTCFixture(t, srv, it)
		res := race(2, func(i int) raceResp {
			tk := []string{f.host, f.co}[i]
			return fire(srv, "POST", "/api/rooms/"+f.roomID+"/timer", tcBody("pause", f.rev), tk, "")
		})
		for i, r := range res {
			if r.Err != nil || r.Status != 200 {
				t.Fatalf("iter %d request %d: %d %v %s", it, i, r.Status, r.Err, r.Body)
			}
		}
		var first *Timer
		for _, s := range []*raceStream{f.hs, f.cs, f.gs} {
			rm := s.waitRoom(func(r *Room) bool { return r != nil && r.Timer != nil && r.Timer.AnchorAt == nil }, 5*time.Second)
			if rm.TimerRev != f.rev {
				t.Fatalf("iter %d: rev %d, want %d", it, rm.TimerRev, f.rev)
			}
			if first == nil {
				first = rm.Timer
			} else if !sameTimer(rm.Timer, first) {
				t.Fatalf("iter %d: streams disagree %+v vs %+v", it, rm.Timer, first)
			}
		}
	}
}

func TestTimerCmdRaceRestartVsStalePause(t *testing.T) {
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		f := newTCFixture(t, srv, it)
		restart, _ := json.Marshal(map[string]any{"timer": map[string]any{
			"focusMs": 600_000, "breakMs": 300_000, "rounds": 3, "elapsedMs": 0, "anchorAt": 1}})
		res := race(2, func(i int) raceResp {
			if i == 0 {
				return fire(srv, "PATCH", "/api/rooms/"+f.roomID, string(restart), f.host, "")
			}
			return fire(srv, "POST", "/api/rooms/"+f.roomID+"/timer", tcBody("pause", f.rev), f.co, "")
		})
		if res[0].Err != nil || res[0].Status != 200 {
			t.Fatalf("iter %d restart: %d %v %s", it, res[0].Err, res[0].Status, res[0].Body)
		}
		p := res[1]
		switch p.Status {
		case 200: // landed before the restart; the restart replaced it
		case 409:
			var b struct {
				Error string `json:"error"`
				Room  *Room  `json:"room"`
			}
			if json.Unmarshal([]byte(p.Body), &b) != nil || b.Error != "the timer changed" || b.Room == nil ||
				b.Room.TimerRev != f.rev+1 || b.Room.Timer.Rounds != 3 || b.Room.Timer.AnchorAt == nil {
				t.Fatalf("iter %d 409 body: %s", it, p.Body)
			}
		default:
			t.Fatalf("iter %d pause: %d %v %s", it, p.Status, p.Err, p.Body)
		}
		for _, s := range []*raceStream{f.hs, f.cs, f.gs} {
			rm := s.waitRoom(func(r *Room) bool { return r != nil && r.TimerRev == f.rev+1 && r.Timer != nil && r.Timer.Rounds == 3 }, 5*time.Second)
			if rm.Timer.AnchorAt == nil {
				t.Fatalf("iter %d: restarted timer ended up paused: %+v", it, rm.Timer)
			}
		}
	}
}

func TestTimerCmdRacePauseVsResume(t *testing.T) {
	for it := range repeatCount() {
		srv, _, h := newRaceServer(t)
		f := newTCFixture(t, srv, it)
		// Start paused so resume has something to do.
		if r := fire(srv, "POST", "/api/rooms/"+f.roomID+"/timer", tcBody("pause", f.rev), f.host, ""); r.Status != 200 {
			t.Fatalf("iter %d setup pause: %d %s", it, r.Status, r.Body)
		}
		res := race(2, func(i int) raceResp {
			if i == 0 {
				return fire(srv, "POST", "/api/rooms/"+f.roomID+"/timer", tcBody("pause", f.rev), f.host, "")
			}
			return fire(srv, "POST", "/api/rooms/"+f.roomID+"/timer", tcBody("resume", f.rev), f.co, "")
		})
		for i, r := range res {
			if r.Err != nil || r.Status != 200 {
				t.Fatalf("iter %d request %d: %d %v %s", it, i, r.Status, r.Err, r.Body)
			}
		}
		// Exactly one final state: the hub's, which every stream must reach.
		final, _ := h.room(f.roomID)
		if final.TimerRev != f.rev || final.Timer == nil {
			t.Fatalf("iter %d: final %+v", it, final)
		}
		for _, s := range []*raceStream{f.hs, f.cs, f.gs} {
			s.waitRoom(func(r *Room) bool {
				return r != nil && r.Timer != nil && sameTimer(r.Timer, final.Timer) && r.TimerRev == f.rev
			}, 5*time.Second)
		}
	}
}

// sameTimer compares timers by value; Timer holds a pointer, so == would not.
func sameTimer(a, b *Timer) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
