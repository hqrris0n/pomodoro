package main

// Account links: which device token holds each account's session, so that a
// login on a new device can kick the old one out and take its place in a room.
//
// The profile store and the hub have separate locks and are never held
// together, so a login updates the store first and the hub afterwards. Two
// concurrent logins can therefore reach the hub in either order. The store
// gives every session a generation that only grows, and the store's own order
// decides which session survives: the one with the highest generation. The
// hub keeps the generation of the link it holds and ignores any claim that is
// not newer, so whatever order the claims arrive in, the link (and with it the
// room role) ends with the device whose session the store kept. A claim that
// arrives early just hands the role on once more when the newer claim lands.

// accountLink is the device token holding an account's session and that
// session's generation.
type accountLink struct {
	token string
	gen   uint64
}

const sessionRevoked = "revoked"

func (h *hub) sessionFrame(state string) []byte {
	return frame("session", struct {
		Now   int64  `json:"now"`
		State string `json:"state"`
	}{h.nowMs(), state})
}

// ClaimAccount records that the device token holds session gen of username.
// It is called after the store granted (or confirmed) that session, with the
// store lock released. A claim that is not newer than the current link does
// nothing. replaced is the store's word that this session ended a live one
// (sessionGrant.Replaced; false for sign-up and re-links). Only then, and if
// the link moves to a different device, does the previously linked device get
// a "session: revoked" event and, if it is in a room, this device take over
// its membership (see handoverLocked). A device that had already logged out
// or expired keeps its place.
//
// The handover is always from the device the hub links now, not from the one
// the store replaced: if C (replaced B) is heard before B (replaced A), C
// takes over from A and B's late claim is ignored.
func (h *hub) ClaimAccount(username string, gen uint64, token string, replaced bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	k := profileKey(username)
	prev, linked := h.accounts[k]
	if linked && prev.gen >= gen {
		return // a newer session has claimed already; this one is dead in the store
	}
	h.accounts[k] = accountLink{token: token, gen: gen}
	if !linked || prev.token == token || !replaced {
		return
	}
	old := h.clients[prev.token]
	if old == nil {
		return // forgotten by Sweep: no stream and no room
	}
	h.send(old, h.sessionFrame(sessionRevoked))
	h.handoverLocked(old, token)
	h.publish()
}

// ReleaseAccount removes username's link if it points at token (logout or
// account deletion on that device). Rooms are untouched and no event is sent.
func (h *hub) ReleaseAccount(username, token string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	k := profileKey(username)
	if l, ok := h.accounts[k]; ok && l.token == token {
		delete(h.accounts, k)
	}
}

// handoverLocked gives old's room membership to the device newToken: same
// name, role, joinedAt and place in the member list. newToken first leaves any
// room it is in under the usual rules (including old's room, if it was a
// member there too). old then rejoins as a guest under its own stream name, if
// the room has space. If old is in no room nothing changes. Lock held; the
// caller publishes.
func (h *hub) handoverLocked(old *client, newToken string) {
	r := h.rooms[old.roomID]
	if r == nil {
		return
	}
	nc, err := h.clientLocked(newToken)
	if err != nil {
		return // server busy: the old device keeps its place
	}
	h.leaveLocked(nc)
	var m *member
	for _, x := range r.members {
		if x.c == old {
			m = x
			break
		}
	}
	if m == nil {
		return // unreachable: old.roomID always names a room old is in
	}
	r.dropClaims(old.id) // the new device holds none
	m.c = nc
	nc.roomID = r.id
	old.roomID = ""
	old.notes = nil // notes queued for the membership that moved
	h.dirty[old] = struct{}{}
	h.dirty[nc] = struct{}{}
	if len(r.members) < maxMembers {
		name := old.name
		if name == "" {
			name = m.name
		}
		r.members = append(r.members, &member{c: old, name: name, role: roleGuest, joinedAt: h.nowMs()})
		old.roomID = r.id
	}
	h.touchAll(r)
}
