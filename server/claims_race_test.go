package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// claimFixture is a room with host (tok base+1) and co-host (tok base+2), both
// streaming, built over HTTP with fresh tokens for each repetition.
type claimFixture struct {
	srv          *httptest.Server
	h            *hub
	path         string
	host, co     string
	hs, cs       *raceStream
	hostID, coID string
}

func newClaimFixture(t *testing.T, it int) claimFixture {
	t.Helper()
	srv, h, _ := newRaceServerClock(t)
	f := claimFixture{srv: srv, h: h, host: tok(3*it + 1), co: tok(3*it + 2)}
	f.hs, f.cs = openStream(t, srv, f.host, "Ada"), openStream(t, srv, f.co, "Bo")
	room, err := h.CreateRoom(f.host, "Ada", testSettings(), testTimer(h, false))
	if err != nil {
		t.Fatal(err)
	}
	f.path = "/api/rooms/" + room.ID
	f.hostID, f.coID = memberID(f.host), memberID(f.co)
	if r := fire(srv, "POST", f.path+"/join", `{"name":"Bo"}`, f.co, ""); r.Err != nil || r.Status != http.StatusOK {
		t.Fatalf("join: %d %v %s", r.Status, r.Err, r.Body)
	}
	body := fmt.Sprintf(`{"memberId":%q,"role":"cohost"}`, f.coID)
	if r := fire(srv, "POST", f.path+"/role", body, f.host, ""); r.Err != nil || r.Status != http.StatusOK {
		t.Fatalf("role: %d %v %s", r.Status, r.Err, r.Body)
	}
	return f
}

// (a) Two owners claim the same channel together: one wins, both see the winner.
func TestRaceClaimSameChannel(t *testing.T) {
	for it := range repeatCount() {
		t.Run(fmt.Sprint(it), func(t *testing.T) {
			f := newClaimFixture(t, it)
			res := race(2, func(i int) raceResp {
				return fire(f.srv, "POST", f.path+"/claim", `{"channel":"rain"}`, []string{f.host, f.co}[i], "")
			})
			ok, conflict, winner := 0, 0, ""
			for i, r := range res {
				switch {
				case r.Err != nil:
					t.Fatal(r.Err)
				case r.Status == 200:
					ok++
					winner = []string{f.hostID, f.coID}[i]
				case r.Status == 409:
					conflict++
				}
			}
			if ok != 1 || conflict != 1 {
				t.Fatalf("statuses %d, %d", res[0].Status, res[1].Status)
			}
			for _, s := range []*raceStream{f.hs, f.cs} {
				r := s.waitRoom(func(r *Room) bool { return r != nil && len(r.Claims) == 1 }, 5*time.Second)
				if r.Claims["rain"] != winner {
					t.Fatalf("stream shows %v, winner %s", r.Claims, winner)
				}
			}
		})
	}
}

// (b) The holder renews while the host demotes them: whatever the order, they
// end as a guest holding nothing.
func TestRaceClaimRenewVersusDemotion(t *testing.T) {
	for it := range repeatCount() {
		t.Run(fmt.Sprint(it), func(t *testing.T) {
			f := newClaimFixture(t, it)
			if r := fire(f.srv, "POST", f.path+"/claim", `{"channel":"rain"}`, f.co, ""); r.Status != 200 {
				t.Fatalf("claim: %d %s", r.Status, r.Body)
			}
			demote := fmt.Sprintf(`{"memberId":%q,"role":"guest"}`, f.coID)
			res := race(2, func(i int) raceResp {
				if i == 0 {
					return fire(f.srv, "POST", f.path+"/claim", `{"channel":"rain"}`, f.co, "")
				}
				return fire(f.srv, "POST", f.path+"/role", demote, f.host, "")
			})
			if res[1].Status != 200 || (res[0].Status != 200 && res[0].Status != 403) {
				t.Fatalf("renew %d %s, demote %d %s", res[0].Status, res[0].Body, res[1].Status, res[1].Body)
			}
			r := f.cs.waitRoom(func(r *Room) bool { return r != nil && roleOf(*r, f.co) == roleGuest }, 5*time.Second)
			if len(r.Claims) != 0 {
				t.Fatalf("demoted member still holds %v", r.Claims)
			}
			if v, _ := f.h.room(r.ID); len(v.Claims) != 0 || roleOf(v, f.co) != roleGuest {
				t.Fatalf("hub view: %+v", v)
			}
		})
	}
}

// (c) The holder's PATCH races another owner's PATCH of the same channel: the
// other one is refused every time and the holder's level stands.
func TestRaceClaimPatchVersusPatch(t *testing.T) {
	for it := range repeatCount() {
		t.Run(fmt.Sprint(it), func(t *testing.T) {
			f := newClaimFixture(t, it)
			if r := fire(f.srv, "POST", f.path+"/claim", `{"channel":"rain"}`, f.co, ""); r.Status != 200 {
				t.Fatalf("claim: %d %s", r.Status, r.Body)
			}
			res := race(2, func(i int) raceResp {
				if i == 0 {
					return fire(f.srv, "PATCH", f.path, `{"settings":{"mix":{"rain":0.8}}}`, f.co, "")
				}
				return fire(f.srv, "PATCH", f.path, `{"settings":{"mix":{"rain":0.2}}}`, f.host, "")
			})
			if res[0].Err != nil || res[0].Status != 200 || res[1].Err != nil || res[1].Status != 409 {
				t.Fatalf("holder %d %s, other %d %s", res[0].Status, res[0].Body, res[1].Status, res[1].Body)
			}
			v, _ := f.h.room(f.path[len("/api/rooms/"):])
			if v.Settings.Mix["rain"] != 0.8 || v.Claims["rain"] != f.coID {
				t.Fatalf("room: mix %v claims %v", v.Settings.Mix, v.Claims)
			}
		})
	}
}
