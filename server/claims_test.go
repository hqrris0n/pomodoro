package main

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// claimRoom is a room with host H (tok 1), co-host A (tok 2) and guest G (tok 3).
func claimRoom(t *testing.T) (*hub, *fakeClock, string) {
	t.Helper()
	h, clk, r := succRoom(t)
	setRole(t, h, clk, r.ID, tok(1), tok(2), roleCohost)
	return h, clk, r.ID
}

func wantClaims(t *testing.T, h *hub, id string, want map[string]string) {
	t.Helper()
	r, _ := h.room(id)
	if !reflect.DeepEqual(r.Claims, want) {
		t.Fatalf("claims %v, want %v", r.Claims, want)
	}
}

func mixPatch(ch string, v float64) *settingsPatch {
	return &settingsPatch{Mix: map[string]float64{ch: v}}
}

func TestClaimFirstComeFirstServed(t *testing.T) {
	h, _, id := claimRoom(t)
	a, hh := memberID(tok(2)), memberID(tok(1))
	if r, err := h.Claim(tok(2), id, "rain"); err != nil || !reflect.DeepEqual(r.Claims, map[string]string{"rain": a}) {
		t.Fatalf("claim: %v %v", r.Claims, err)
	}
	_, err := h.Claim(tok(1), id, "rain") // the host does not outrank a co-host
	wantStatus(t, err, 409)
	if err.Error() != "someone is adjusting that" {
		t.Fatal(err)
	}
	if _, err := h.Claim(tok(1), id, "fire"); err != nil {
		t.Fatal(err)
	}
	wantClaims(t, h, id, map[string]string{"rain": a, "fire": hh})
	_, err = h.Claim(tok(3), id, "wind")
	if err != errNotOwner {
		t.Fatalf("guest claim: %v", err)
	}
	if _, err := h.Claim(tok(9), id, "wind"); err != errNotMember {
		t.Fatalf("outsider claim: %v", err)
	}
}

func TestClaimRenewAndExpiry(t *testing.T) {
	h, clk, id := claimRoom(t)
	h.Claim(tok(2), id, "rain")
	clk.Advance(4 * time.Second)
	if _, err := h.Claim(tok(2), id, "rain"); err != nil { // renew
		t.Fatal(err)
	}
	clk.Advance(4 * time.Second) // 8 s after the first claim, 4 after the renewal
	_, err := h.Claim(tok(1), id, "rain")
	wantStatus(t, err, 409)
	clk.Advance(time.Second) // 5 s after the renewal: expired
	if r, _ := h.room(id); len(r.Claims) != 0 {
		t.Fatalf("expired claim still in view: %v", r.Claims)
	}
	if _, err := h.Claim(tok(1), id, "rain"); err != nil {
		t.Fatal(err)
	}
	wantClaims(t, h, id, map[string]string{"rain": memberID(tok(1))})
}

func TestExpireClaimsPublishesOnlyOnChange(t *testing.T) {
	h, clk, id := claimRoom(t)
	cn, _ := h.Connect(tok(1), "")
	h.Claim(tok(2), id, "rain")
	drain(cn)
	h.ExpireClaims()
	if evs := drain(cn); len(evs) != 0 {
		t.Fatalf("event without a change: %v", evs)
	}
	clk.Advance(5 * time.Second)
	h.ExpireClaims()
	ev := lastOf(drain(cn), "room")
	if ev == nil {
		t.Fatal("no room event after expiry")
	}
	if c := ev.data["room"].(map[string]any)["claims"].(map[string]any); len(c) != 0 {
		t.Fatalf("claims %v", c)
	}
	h.Claim(tok(2), id, "rain")
	clk.Advance(5 * time.Second)
	drain(cn)
	h.Sweep()
	if lastOf(drain(cn), "room") == nil {
		t.Fatal("Sweep did not expire the claim")
	}
}

func TestReleaseClaim(t *testing.T) {
	h, _, id := claimRoom(t)
	h.Claim(tok(2), id, "rain")
	if _, err := h.ReleaseClaim(tok(1), id, "rain"); err != nil { // not the holder: no-op
		t.Fatal(err)
	}
	wantClaims(t, h, id, map[string]string{"rain": memberID(tok(2))})
	if _, err := h.ReleaseClaim(tok(2), id, "fire"); err != nil {
		t.Fatal(err)
	}
	if r, err := h.ReleaseClaim(tok(2), id, "rain"); err != nil || len(r.Claims) != 0 {
		t.Fatalf("release: %v %v", r.Claims, err)
	}
	if _, err := h.ReleaseClaim(tok(3), id, "rain"); err != nil { // a guest may call it
		t.Fatal(err)
	}
}

func TestPatchRespectsClaims(t *testing.T) {
	h, clk, id := claimRoom(t)
	h.Claim(tok(2), id, "rain")
	before, _ := h.room(id)
	tm := testTimer(h, true)
	for _, tc := range []struct {
		name string
		s    *settingsPatch
		t    *Timer
	}{
		{"mix only", mixPatch("rain", 0.3), nil},
		{"with timer", mixPatch("rain", 0.3), &tm},
		{"with other fields", &settingsPatch{Mix: map[string]float64{"fire": 0.2, "rain": 0.3}, DrinkID: ptr("mocha")}, nil},
	} {
		_, err := h.Patch(tok(1), id, tc.s, tc.t, false)
		wantStatus(t, err, 409)
		if after, _ := h.room(id); !reflect.DeepEqual(after, before) {
			t.Fatalf("%s: room changed: %+v", tc.name, after)
		}
	}
	if _, err := h.Patch(tok(1), id, mixPatch("fire", 0.3), nil, false); err != nil { // unclaimed
		t.Fatal(err)
	}
	clk.Advance(4 * time.Second)
	if _, err := h.Patch(tok(2), id, mixPatch("rain", 0.3), nil, false); err != nil { // holder renews
		t.Fatal(err)
	}
	clk.Advance(4 * time.Second)
	_, err := h.Patch(tok(1), id, mixPatch("rain", 0.9), nil, false)
	wantStatus(t, err, 409)
	clk.Advance(time.Second)
	if _, err := h.Patch(tok(1), id, mixPatch("rain", 0.9), nil, false); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
}

func TestClaimsEndWithMembership(t *testing.T) {
	setup := func(t *testing.T) (*hub, *fakeClock, string) {
		h, clk, id := claimRoom(t)
		h.Claim(tok(2), id, "rain")
		h.Claim(tok(2), id, "fire")
		h.Claim(tok(1), id, "wind")
		return h, clk, id
	}
	hostOnly := map[string]string{"wind": memberID(tok(1))}
	t.Run("demotion", func(t *testing.T) {
		h, _, id := setup(t)
		if _, err := h.SetRole(tok(1), id, memberID(tok(2)), roleGuest); err != nil {
			t.Fatal(err)
		}
		wantClaims(t, h, id, hostOnly)
	})
	t.Run("leave", func(t *testing.T) {
		h, _, id := setup(t)
		if err := h.Leave(tok(2), id); err != nil {
			t.Fatal(err)
		}
		wantClaims(t, h, id, hostOnly)
	})
	t.Run("grace removal", func(t *testing.T) {
		h, clk, id := setup(t)
		h.Connect(tok(1), "") // the host stays connected
		cn, _ := h.Connect(tok(2), "")
		clk.Advance(time.Second)
		h.Detach(cn)
		clk.Advance(gracePeriod)
		h.Claim(tok(1), id, "wind") // keep the host's claim fresh
		h.Sweep()
		wantClaims(t, h, id, hostOnly)
	})
	t.Run("host leaves, co-host keeps claims", func(t *testing.T) {
		h, _, id := setup(t)
		if err := h.Leave(tok(1), id); err != nil {
			t.Fatal(err)
		}
		r, _ := h.room(id)
		if roleOf(r, tok(2)) != roleHost || len(r.Claims) != 2 {
			t.Fatalf("role %s claims %v", roleOf(r, tok(2)), r.Claims)
		}
	})
	t.Run("handover", func(t *testing.T) {
		h, _, id := setup(t)
		h.ClaimAccount("Ada", 1, tok(2), false)
		h.ClaimAccount("Ada", 2, tok(7), true)
		wantClaims(t, h, id, hostOnly)
		if _, err := h.Claim(tok(7), id, "rain"); err != nil { // the new device took the seat
			t.Fatal(err)
		}
	})
}

func TestClaimHTTPValidation(t *testing.T) {
	srv, _, _ := newRaceServerClock(t)
	host := tok(1)
	rr := fire(srv, "POST", "/api/rooms", fmt.Sprintf(`{"name":"Ada","settings":{"drinkId":"a","backgroundId":"b","backgroundRotateMin":0,"mix":{}},"timer":{"focusMs":1500000,"breakMs":300000,"rounds":2,"elapsedMs":0,"anchorAt":null}}`), host, "")
	if rr.Status != 200 {
		t.Fatalf("create: %d %s", rr.Status, rr.Body)
	}
	id := strings.Split(strings.Split(rr.Body, `"id":"`)[1], `"`)[0]
	for body, want := range map[string]int{
		`{"channel":""}`: 400,
		`{"channel":"` + strings.Repeat("x", 33) + `"}`: 400,
		`{"channel":"` + strings.Repeat("x", 32) + `"}`: 200,
		`{"channel":"rain"}`:                            200,
		`{}`:                                            400,
	} {
		if r := fire(srv, "POST", "/api/rooms/"+id+"/claim", body, host, ""); r.Status != want {
			t.Errorf("claim %.20s: %d, want %d (%s)", body, r.Status, want, r.Body)
		}
	}
	if r := fire(srv, "POST", "/api/rooms/"+id+"/release", `{"channel":"rain"}`, host, ""); r.Status != 200 || !strings.Contains(r.Body, `"claims":{"`+strings.Repeat("x", 32)+`"`) {
		t.Errorf("release: %d %s", r.Status, r.Body)
	}
	if r := fire(srv, "POST", "/api/rooms/"+id+"/claim", `{"channel":"rain"}`, tok(5), ""); r.Status != 403 {
		t.Errorf("outsider: %d", r.Status)
	}
	if r := fire(srv, "POST", "/api/rooms/nope/claim", `{"channel":"rain"}`, host, ""); r.Status != 404 {
		t.Errorf("no room: %d", r.Status)
	}
}
