package main

const (
	timerPause     = "pause"
	timerResume    = "resume"
	timerSkipBreak = "skipBreak"
)

// timerChanged is the 409 for a command aimed at a timer that was replaced; it
// carries the current room so the client can adopt it.
type timerChanged struct {
	*apiError
	room Room
}

func (e *timerChanged) Unwrap() error { return e.apiError }

// TimerCommand applies an idempotent pause, resume or skipBreak to the room's
// timer, computed with the server clock; host and co-hosts only. rev is the
// timerRev the caller last saw: if the timer has been replaced or cleared
// since, or there is none, the command is refused with 409 carrying the
// current Room. The commands never change timerRev, and one that finds
// nothing to do changes and publishes nothing.
func (h *hub) TimerCommand(token, roomID, action string, rev uint64) (Room, error) {
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
	if r.timer == nil || rev != r.timerRev {
		v := r.view()
		return Room{}, &timerChanged{&apiError{409, "the timer changed"}, v}
	}
	now := h.nowMs()
	t := *r.timer
	if !t.apply(action, now) {
		return r.view(), nil
	}
	r.timer = &t
	r.setAt = h.now()
	h.touchAll(r)
	h.publish()
	return r.view(), nil
}

func (t Timer) elapsed(now int64) int64 {
	if t.AnchorAt == nil {
		return t.ElapsedMs
	}
	return t.ElapsedMs + now - *t.AnchorAt
}

// apply runs a timer command at now (epoch ms) and reports whether t changed.
func (t *Timer) apply(action string, now int64) bool {
	total := t.total()
	el := t.elapsed(now)
	switch action {
	case timerPause:
		if t.AnchorAt == nil {
			return false
		}
		t.ElapsedMs, t.AnchorAt = min(el, total), nil
	case timerResume:
		if t.AnchorAt != nil || t.ElapsedMs >= total {
			return false
		}
		t.AnchorAt = &now
	case timerSkipBreak:
		cycle := t.FocusMs + t.BreakMs
		if el >= total || el%cycle < t.FocusMs {
			return false
		}
		t.ElapsedMs = (el/cycle + 1) * cycle
		if t.AnchorAt != nil {
			t.AnchorAt = &now
		}
	}
	return true
}
