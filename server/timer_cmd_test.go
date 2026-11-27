package main

import (
	"strings"
	"testing"
	"time"
)

// Timer used here: focus 25 min, break 5 min, 2 rounds; cycle 30 min, total 55 min.
const (
	tcFocus = 1_500_000
	tcCycle = 1_800_000
)

func tcRoom(t *testing.T, h *hub, running bool) (Room, *conn) {
	t.Helper()
	room := mustCreate(t, h, tok(1), "Ada")
	if running {
		tm := testTimer(h, true)
		var err error
		if room, err = h.Patch(tok(1), room.ID, nil, &tm, false); err != nil {
			t.Fatal(err)
		}
	}
	cn, err := h.Connect(tok(1), "")
	if err != nil {
		t.Fatal(err)
	}
	drain(cn)
	return room, cn
}

func TestTimerCmdPauseRunning(t *testing.T) {
	h, clk := newTestHub()
	room, cn := tcRoom(t, h, true)
	mustJoin(t, h, tok(2), room.ID, "Bo")
	if _, err := h.SetRole(tok(1), room.ID, memberID(tok(2)), roleCohost); err != nil {
		t.Fatal(err)
	}
	drain(cn)
	clk.Advance(90 * time.Second)
	got, err := h.TimerCommand(tok(2), room.ID, timerPause, room.TimerRev)
	if err != nil {
		t.Fatal(err)
	}
	if got.Timer.AnchorAt != nil || got.Timer.ElapsedMs != 90_000 || got.TimerRev != room.TimerRev {
		t.Fatalf("timer %+v rev %d (was %d)", got.Timer, got.TimerRev, room.TimerRev)
	}
	if ev := lastOf(drain(cn), "room"); ev == nil {
		t.Fatal("no room event")
	}
}

func TestTimerCmdPauseClampsToTotal(t *testing.T) {
	h, clk := newTestHub()
	room, _ := tcRoom(t, h, true)
	clk.Advance(2 * time.Hour)
	got, err := h.TimerCommand(tok(1), room.ID, timerPause, room.TimerRev)
	if err != nil || got.Timer.ElapsedMs != 3_300_000 || got.Timer.AnchorAt != nil {
		t.Fatalf("%+v %v", got.Timer, err)
	}
}

func TestTimerCmdPauseWhenPausedIsNoop(t *testing.T) {
	h, clk := newTestHub()
	room, cn := tcRoom(t, h, false)
	clk.Advance(time.Minute)
	got, err := h.TimerCommand(tok(1), room.ID, timerPause, room.TimerRev)
	if err != nil || got.Timer.ElapsedMs != 0 || got.Timer.AnchorAt != nil {
		t.Fatalf("%+v %v", got.Timer, err)
	}
	if evs := drain(cn); len(evs) != 0 {
		t.Fatalf("unexpected events %v", evs)
	}
}

func TestTimerCmdResume(t *testing.T) {
	h, clk := newTestHub()
	room, cn := tcRoom(t, h, false)
	clk.Advance(time.Minute)
	got, err := h.TimerCommand(tok(1), room.ID, timerResume, room.TimerRev)
	if err != nil || got.Timer.AnchorAt == nil || *got.Timer.AnchorAt != h.nowMs() || got.Timer.ElapsedMs != 0 {
		t.Fatalf("%+v %v", got.Timer, err)
	}
	if lastOf(drain(cn), "room") == nil {
		t.Fatal("no room event")
	}
	// Running: no-op.
	anchor := *got.Timer.AnchorAt
	clk.Advance(time.Minute)
	got, err = h.TimerCommand(tok(1), room.ID, timerResume, room.TimerRev)
	if err != nil || *got.Timer.AnchorAt != anchor || len(drain(cn)) != 0 {
		t.Fatalf("resume on running changed %+v %v", got.Timer, err)
	}
}

func TestTimerCmdResumeFinishedIsNoop(t *testing.T) {
	h, _ := newTestHub()
	room, cn := tcRoom(t, h, true)
	h.mu.Lock()
	r := h.rooms[room.ID]
	r.timer.ElapsedMs, r.timer.AnchorAt = r.timer.total(), nil
	h.mu.Unlock()
	got, err := h.TimerCommand(tok(1), room.ID, timerResume, room.TimerRev)
	if err != nil || got.Timer.AnchorAt != nil || len(drain(cn)) != 0 {
		t.Fatalf("%+v %v", got.Timer, err)
	}
}

func TestTimerCmdSkipBreak(t *testing.T) {
	for _, running := range []bool{true, false} {
		h, clk := newTestHub()
		room, _ := tcRoom(t, h, running)
		// 26 minutes in: inside the first break.
		if running {
			clk.Advance(26 * time.Minute)
		} else {
			h.mu.Lock()
			h.rooms[room.ID].timer.ElapsedMs = 26 * 60_000
			h.mu.Unlock()
		}
		got, err := h.TimerCommand(tok(1), room.ID, timerSkipBreak, room.TimerRev)
		if err != nil || got.Timer.ElapsedMs != tcCycle {
			t.Fatalf("running=%v: %+v %v", running, got.Timer, err)
		}
		if running && (got.Timer.AnchorAt == nil || *got.Timer.AnchorAt != h.nowMs()) {
			t.Fatalf("running timer lost its anchor: %+v", got.Timer)
		}
		if !running && got.Timer.AnchorAt != nil {
			t.Fatalf("paused timer started: %+v", got.Timer)
		}
	}
}

func TestTimerCmdSkipBreakOutsideBreakIsNoop(t *testing.T) {
	h, clk := newTestHub()
	room, cn := tcRoom(t, h, true)
	clk.Advance(10 * time.Minute) // focus
	before := *room.Timer
	got, err := h.TimerCommand(tok(1), room.ID, timerSkipBreak, room.TimerRev)
	if err != nil || !sameTimer(got.Timer, &before) || len(drain(cn)) != 0 {
		t.Fatalf("%+v %v", got.Timer, err)
	}
	// Last focus round, and done: no break either.
	for _, ms := range []int64{tcCycle + 10*60_000, 3_300_000} {
		h.mu.Lock()
		h.rooms[room.ID].timer.ElapsedMs, h.rooms[room.ID].timer.AnchorAt = ms, nil
		h.mu.Unlock()
		got, err = h.TimerCommand(tok(1), room.ID, timerSkipBreak, room.TimerRev)
		if err != nil || got.Timer.ElapsedMs != ms || len(drain(cn)) != 0 {
			t.Fatalf("elapsed %d: %+v %v", ms, got.Timer, err)
		}
	}
}

func TestTimerCmdConflicts(t *testing.T) {
	h, _ := newTestHub()
	room, cn := tcRoom(t, h, false)
	restart := testTimer(h, true)
	cur, err := h.Patch(tok(1), room.ID, nil, &restart, false)
	if err != nil {
		t.Fatal(err)
	}
	drain(cn)
	_, err = h.TimerCommand(tok(1), room.ID, timerPause, room.TimerRev)
	ae, ok := err.(*timerChanged)
	if !ok || ae.status != 409 || ae.msg != "the timer changed" || ae.room.TimerRev != cur.TimerRev || ae.room.Timer.AnchorAt == nil {
		t.Fatalf("conflict %+v", ae)
	}
	if len(drain(cn)) != 0 {
		t.Fatal("conflict published")
	}
	// No timer.
	if _, err := h.Patch(tok(1), room.ID, nil, nil, true); err != nil {
		t.Fatal(err)
	}
	cur, _ = h.room(room.ID)
	_, err = h.TimerCommand(tok(1), room.ID, timerResume, cur.TimerRev)
	if ae, ok := err.(*timerChanged); !ok || ae.status != 409 || ae.room.Timer != nil || ae.room.TimerRev != cur.TimerRev {
		t.Fatalf("no-timer conflict %+v", ae)
	}
}

func TestTimerCmdPermissions(t *testing.T) {
	h, _ := newTestHub()
	room, _ := tcRoom(t, h, false)
	mustJoin(t, h, tok(2), room.ID, "Bo")
	_, err := h.TimerCommand(tok(2), room.ID, timerPause, room.TimerRev)
	wantStatus(t, err, 403)
	_, err = h.TimerCommand(tok(3), room.ID, timerPause, room.TimerRev)
	wantStatus(t, err, 403)
	_, err = h.TimerCommand(tok(1), "nope", timerPause, 0)
	wantStatus(t, err, 404)
}

func TestTimerCmdHTTP(t *testing.T) {
	e := newEnv(t)
	_, body := e.do(t, "POST", "/api/rooms", tok(1), createBody(func(m map[string]any) { sub(m, "timer")["anchorAt"] = 1 }))
	id := strings.Split(strings.Split(body, `"id":"`)[1], `"`)[0]
	path := "/api/rooms/" + id + "/timer"
	e.clk.Advance(time.Minute)
	if st, b := e.do(t, "POST", path, tok(1), map[string]any{"action": "pause", "rev": 1}); st != 200 || !strings.Contains(b, `"elapsedMs":60000`) || !strings.Contains(b, `"anchorAt":null`) {
		t.Fatalf("pause: %d %s", st, b)
	}
	if st, _ := e.do(t, "POST", path, tok(1), map[string]any{"action": "pause", "rev": 1}); st != 200 {
		t.Fatalf("second pause: %d", st)
	}
	if st, b := e.do(t, "POST", path, tok(1), map[string]any{"action": "pause", "rev": 2}); st != 409 || !strings.Contains(b, `"error":"the timer changed"`) || !strings.Contains(b, `"room":{"id":"`+id) {
		t.Fatalf("stale: %d %s", st, b)
	}
	for _, bad := range []any{
		map[string]any{"action": "toggle", "rev": 1},
		map[string]any{"action": "", "rev": 1},
		map[string]any{"action": "pause"},
		map[string]any{"action": "pause", "rev": -1},
		map[string]any{"action": "pause", "rev": "0"},
		map[string]any{"action": "pause", "rev": 1, "extra": 1},
	} {
		if st, b := e.do(t, "POST", path, tok(1), bad); st != 400 {
			t.Fatalf("%v: %d %s", bad, st, b)
		}
	}
	e.do(t, "POST", "/api/rooms/"+id+"/join", tok(2), map[string]any{"name": "Bo"})
	if st, _ := e.do(t, "POST", path, tok(2), map[string]any{"action": "resume", "rev": 1}); st != 403 {
		t.Fatalf("guest: %d", st)
	}
}
