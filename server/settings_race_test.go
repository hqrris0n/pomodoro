package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"
)

// Host and co-host change different settings at the same moment; both
// changes must be in the room both of them see.
func TestRaceSettingsPatchesBothSurvive(t *testing.T) {
	cases := []struct {
		name       string
		hostBody   string
		cohostBody string
		check      func(r *Room) bool
	}{
		{"two channels",
			`{"settings":{"mix":{"rain":0.4}}}`, `{"settings":{"mix":{"fire":0.7}}}`,
			func(r *Room) bool { return r.Settings.Mix["rain"] == 0.4 && r.Settings.Mix["fire"] == 0.7 }},
		{"background and channel",
			`{"settings":{"backgroundId":"night"}}`, `{"settings":{"mix":{"fire":0.7}}}`,
			func(r *Room) bool {
				return r.Settings.BackgroundID == "night" && r.Settings.Mix["fire"] == 0.7 && r.Settings.Mix["rain"] == 0.5
			}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			for it := range repeatCount() {
				t.Run(fmt.Sprint(it), func(t *testing.T) {
					srv, _, _ := newRaceServer(t)
					host, co := tok(2*it+1), tok(2*it+2) // fresh tokens each repetition
					hs, cs := openStream(t, srv, host, "Ada"), openStream(t, srv, co, "Bo")
					body, _ := json.Marshal(createBody(nil))
					resp := fire(srv, "POST", "/api/rooms", string(body), host, "")
					var room Room
					if resp.Err != nil || json.Unmarshal([]byte(resp.Body), &room) != nil || room.ID == "" {
						t.Fatalf("create: %d %v %s", resp.Status, resp.Err, resp.Body)
					}
					path := "/api/rooms/" + room.ID
					if r := fire(srv, "POST", path+"/join", `{"name":"Bo"}`, co, ""); r.Err != nil || r.Status != http.StatusOK {
						t.Fatalf("join: %d %v %s", r.Status, r.Err, r.Body)
					}
					cs.waitRoom(func(r *Room) bool { return r != nil && len(r.Members) == 2 }, 5*time.Second)
					_, coID := cs.lastRoom()
					rb, _ := json.Marshal(map[string]string{"memberId": coID, "role": "cohost"})
					if r := fire(srv, "POST", path+"/role", string(rb), host, ""); r.Err != nil || r.Status != http.StatusOK {
						t.Fatalf("role: %d %v %s", r.Status, r.Err, r.Body)
					}
					res := race(2, func(i int) raceResp {
						if i == 0 {
							return fire(srv, "PATCH", path, c.hostBody, host, "")
						}
						return fire(srv, "PATCH", path, c.cohostBody, co, "")
					})
					for i, r := range res {
						if r.Err != nil || r.Status != http.StatusOK {
							t.Fatalf("patch %d: %d %v %s", i, r.Status, r.Err, r.Body)
						}
					}
					hs.waitRoom(func(r *Room) bool { return r != nil && c.check(r) }, 5*time.Second)
					cs.waitRoom(func(r *Room) bool { return r != nil && c.check(r) }, 5*time.Second)
				})
			}
		})
	}
}
