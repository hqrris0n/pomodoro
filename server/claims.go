package main

import "time"

// Channel claims: one member at a time controls a sound channel's slider and
// switch. A claim lasts claimTTL after its last use, so a client that vanishes
// mid-drag never blocks the channel for long. See docs/protocol.md.

const claimTTL = 5 * time.Second

var errClaimed = &apiError{409, "someone is adjusting that"}

// claim is one member's hold on a channel; it counts as absent once now >= expires.
type claim struct {
	memberID string
	expires  time.Time
}

// holder returns the member id holding channel at now, if any.
func (r *room) holder(channel string, now time.Time) (string, bool) {
	cl, ok := r.claims[channel]
	if !ok || !now.Before(cl.expires) {
		return "", false
	}
	return cl.memberID, true
}

// claimsView lists the unexpired claims; never nil.
func (r *room) claimsView(now time.Time) map[string]string {
	out := map[string]string{}
	for ch, cl := range r.claims {
		if now.Before(cl.expires) {
			out[ch] = cl.memberID
		}
	}
	return out
}

// dropClaims removes every claim held by memberID and reports whether any went.
func (r *room) dropClaims(memberID string) bool {
	changed := false
	for ch, cl := range r.claims {
		if cl.memberID == memberID {
			delete(r.claims, ch)
			changed = true
		}
	}
	return changed
}

// blockedByClaim reports whether another member holds any channel in mix.
func (r *room) blockedByClaim(mix map[string]float64, me string, now time.Time) bool {
	for ch := range mix {
		if id, ok := r.holder(ch, now); ok && id != me {
			return true
		}
	}
	return false
}

// renewClaims pushes out the expiry of the caller's claims on channels in mix.
func (r *room) renewClaims(mix map[string]float64, me string, now time.Time) {
	for ch := range mix {
		if id, ok := r.holder(ch, now); ok && id == me {
			r.claims[ch] = claim{me, now.Add(claimTTL)}
		}
	}
}

// Claim gives the caller control of a channel unless someone else holds it.
// Host and co-hosts only; the first to ask wins whatever their role.
func (h *hub) Claim(token, roomID, channel string) (Room, error) {
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
	now := h.now()
	if id, ok := r.holder(channel, now); ok && id != c.id {
		return Room{}, errClaimed
	}
	r.claims[channel] = claim{c.id, now.Add(claimTTL)}
	h.touchAll(r)
	h.publish()
	return r.view(), nil
}

// ReleaseClaim ends the caller's claim on a channel; anything else is a no-op.
func (h *hub) ReleaseClaim(token, roomID, channel string) (Room, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c, err := h.clientLocked(token)
	if err != nil {
		return Room{}, err
	}
	r, _, err := h.memberOf(c, roomID)
	if err != nil {
		return Room{}, err
	}
	if id, ok := r.holder(channel, h.now()); ok && id == c.id {
		delete(r.claims, channel)
		h.touchAll(r)
		h.publish()
	}
	return r.view(), nil
}

// expireClaimsLocked removes claims whose time has run out and touches the
// rooms where that changed what members see.
func (h *hub) expireClaimsLocked(now time.Time) {
	for _, r := range h.rooms {
		changed := false
		for ch, cl := range r.claims {
			if !now.Before(cl.expires) {
				delete(r.claims, ch)
				changed = true
			}
		}
		if changed {
			h.touchAll(r)
		}
	}
}

// ExpireClaims removes expired claims and tells the affected rooms.
func (h *hub) ExpireClaims() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.expireClaimsLocked(h.now())
	h.publish()
}

// runClaimExpiry expires claims every interval until stop is closed.
func (h *hub) runClaimExpiry(interval time.Duration, stop <-chan struct{}) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-t.C:
			h.ExpireClaims()
		case <-stop:
			return
		}
	}
}
