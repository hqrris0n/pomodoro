package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"testing"
	"time"
)

// H leaves while two guests join at the same moment. The earliest-promoted
// co-host must end up the only host, and every member's stream must show the
// same members in succession order.
func TestRaceHostLeavesWhileGuestsJoin(t *testing.T) {
	body, _ := json.Marshal(createBody(nil))
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		// Fresh tokens per repetition: 20 requests per 10 s per token.
		base := 100000 + it*10
		host, co1, co2, g1, g2 := tok(base), tok(base+1), tok(base+2), tok(base+3), tok(base+4)
		streams := map[string]*raceStream{}
		for i, tk := range []string{host, co1, co2} {
			streams[tk] = openStream(t, srv, tk, fmt.Sprintf("m%d", i))
		}
		c := fire(srv, "POST", "/api/rooms", string(body), host, "")
		var room Room
		if c.Status != http.StatusOK || json.Unmarshal([]byte(c.Body), &room) != nil {
			t.Fatalf("iter %d create: %d %s", it, c.Status, c.Body)
		}
		// co2 joins first but is promoted second.
		for _, tk := range []string{co2, co1} {
			if r := fire(srv, "POST", "/api/rooms/"+room.ID+"/join", `{"name":"x"}`, tk, ""); r.Status != http.StatusOK {
				t.Fatalf("iter %d join: %d %s", it, r.Status, r.Body)
			}
		}
		for _, tk := range []string{co1, co2} {
			in := `{"memberId":"` + memberID(tk) + `","role":"cohost"}`
			if r := fire(srv, "POST", "/api/rooms/"+room.ID+"/role", in, host, ""); r.Status != http.StatusOK {
				t.Fatalf("iter %d promote: %d %s", it, r.Status, r.Body)
			}
		}
		for i, tk := range []string{g1, g2} {
			streams[tk] = openStream(t, srv, tk, fmt.Sprintf("g%d", i))
		}
		res := race(3, func(i int) raceResp {
			switch i {
			case 0:
				return fire(srv, "POST", "/api/rooms/"+room.ID+"/leave", "", host, "")
			case 1:
				return fire(srv, "POST", "/api/rooms/"+room.ID+"/join", `{"name":"g0"}`, g1, "")
			}
			return fire(srv, "POST", "/api/rooms/"+room.ID+"/join", `{"name":"g1"}`, g2, "")
		})
		for i, r := range res {
			if r.Err != nil || r.Status != http.StatusOK && r.Status != http.StatusNoContent {
				t.Fatalf("iter %d request %d: %d %v %s", it, i, r.Status, r.Err, r.Body)
			}
		}
		final := func(r *Room) bool { return r != nil && len(r.Members) == 4 && r.Members[0].ID != memberID(host) }
		var want []string
		for _, tk := range []string{co1, co2, g1, g2} {
			rm := streams[tk].waitRoom(final, 5*time.Second)
			var ids []string
			hosts := 0
			for _, m := range rm.Members {
				ids = append(ids, m.ID)
				if m.Role == roleHost {
					hosts++
				}
			}
			if hosts != 1 || rm.Members[0].ID != memberID(co1) || rm.Members[1].ID != memberID(co2) || rm.Members[1].Role != roleCohost {
				t.Fatalf("iter %d: members %+v", it, rm.Members)
			}
			if want == nil {
				want = ids
			} else if !reflect.DeepEqual(ids, want) {
				t.Fatalf("iter %d: streams disagree: %v vs %v", it, ids, want)
			}
		}
	}
}
