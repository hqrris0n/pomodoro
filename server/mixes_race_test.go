package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Two co-hosts save a new mix at the same moment; both must succeed and the
// room list, as both of them see it, holds both mixes once each.
func TestRaceAppendMixesBothSurvive(t *testing.T) {
	for it := range repeatCount() {
		t.Run(fmt.Sprint(it), func(t *testing.T) {
			srv, _, _ := newRaceServer(t)
			host, co1, co2 := tok(3*it+1), tok(3*it+2), tok(3*it+3) // fresh tokens each repetition
			openStream(t, srv, host, "Ada")
			s1, s2 := openStream(t, srv, co1, "Bo"), openStream(t, srv, co2, "Cy")
			body, _ := json.Marshal(createBody(nil))
			resp := fire(srv, "POST", "/api/rooms", string(body), host, "")
			var room Room
			if resp.Err != nil || json.Unmarshal([]byte(resp.Body), &room) != nil || room.ID == "" {
				t.Fatalf("create: %d %v %s", resp.Status, resp.Err, resp.Body)
			}
			path := "/api/rooms/" + room.ID
			for _, c := range []struct {
				tok, name string
				s         *raceStream
			}{{co1, "Bo", s1}, {co2, "Cy", s2}} {
				if r := fire(srv, "POST", path+"/join", `{"name":"`+c.name+`"}`, c.tok, ""); r.Err != nil || r.Status != http.StatusOK {
					t.Fatalf("join: %d %v %s", r.Status, r.Err, r.Body)
				}
				c.s.waitRoom(func(r *Room) bool { return r != nil && len(r.Members) >= 2 }, 5*time.Second)
				_, id := c.s.lastRoom()
				rb, _ := json.Marshal(map[string]string{"memberId": id, "role": "cohost"})
				if r := fire(srv, "POST", path+"/role", string(rb), host, ""); r.Err != nil || r.Status != http.StatusOK {
					t.Fatalf("role: %d %v %s", r.Status, r.Err, r.Body)
				}
			}
			bodies := []string{
				`{"settings":{"appendMixes":[{"id":"m1","name":"One","mix":{"rain":0.3}}]}}`,
				`{"settings":{"appendMixes":[{"id":"m2","name":"Two","mix":{"fire":0.6}}]}}`,
			}
			res := race(2, func(i int) raceResp {
				return fire(srv, "PATCH", path, bodies[i], []string{co1, co2}[i], "")
			})
			for i, r := range res {
				if r.Err != nil || r.Status != http.StatusOK {
					t.Fatalf("patch %d: %d %v %s", i, r.Status, r.Err, r.Body)
				}
			}
			both := func(r *Room) bool {
				if r == nil || len(r.Settings.Mixes) != 2 {
					return false
				}
				a, b := r.Settings.Mixes[0].ID, r.Settings.Mixes[1].ID
				return (a == "m1" && b == "m2") || (a == "m2" && b == "m1")
			}
			r1 := s1.waitRoom(both, 5*time.Second)
			r2 := s2.waitRoom(both, 5*time.Second)
			if r1.Settings.Mixes[0].ID != r2.Settings.Mixes[0].ID {
				t.Fatalf("streams disagree: %v vs %v", r1.Settings.Mixes, r2.Settings.Mixes)
			}
		})
	}
}
