package main

import (
	"errors"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const raceN = 8

var raceNames = []string{"ada", "ADA", "Ada", "aDa", "adA", "AdA", "aDA", "ADa"}

const racePW = "correct horse"

func newRaceStore(t *testing.T) *profileStore {
	t.Helper()
	_, clk := newTestHub()
	return openProfilesIter(t.TempDir(), clk.Now, t.Logf, testPBKDF2Iter)
}

func signUpAs(t *testing.T, s *profileStore, name string) sessionGrant {
	t.Helper()
	g, err := s.SignUp(name, "Ada", nil, racePW)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func apiStatus(err error) int {
	var ae *apiError
	if errors.As(err, &ae) {
		return ae.status
	}
	return 0
}

type grantRes struct {
	g   sessionGrant
	err error
}

// stillBlocked reports whether ch delivers nothing within a short wait. It is
// used only to show that something has not finished.
func stillBlocked[T any](ch <-chan T) bool {
	select {
	case <-ch:
		return false
	case <-time.After(50 * time.Millisecond):
		return true
	}
}

func TestRaceSignUpSameName(t *testing.T) {
	for it := range repeatCount() {
		s := newRaceStore(t)
		res := race(raceN, func(i int) grantRes {
			g, err := s.SignUp(raceNames[i], "Ada", nil, racePW)
			return grantRes{g, err}
		})
		wins := 0
		for i, r := range res {
			if r.err == nil {
				wins++
				continue
			}
			if r.err != error(errProfileTaken) || apiStatus(r.err) != 409 || r.err.Error() != "That username is taken." {
				t.Fatalf("iter %d goroutine %d: got %v, want 409 taken", it, i, r.err)
			}
		}
		if wins != 1 {
			t.Fatalf("iter %d: %d successes, want 1", it, wins)
		}
		if len(s.m) != 1 || len(s.bySession) != 1 {
			t.Fatalf("iter %d: %d accounts, %d sessions, want 1 and 1", it, len(s.m), len(s.bySession))
		}
	}
}

func TestRaceLoginOneSessionSurvives(t *testing.T) {
	for it := range repeatCount() {
		s := newRaceStore(t)
		signUpAs(t, s, "ada")
		res := race(raceN, func(int) grantRes {
			g, err := s.Login("ada", racePW)
			return grantRes{g, err}
		})
		var best sessionGrant
		for i, r := range res {
			if r.err != nil {
				t.Fatalf("iter %d login %d: %v", it, i, r.err)
			}
			if r.g.Gen > best.Gen {
				best = r.g
			}
		}
		valid := 0
		for i, r := range res {
			_, gen, err := s.Lookup(r.g.Token)
			if err == nil {
				valid++
				if r.g.Token != best.Token || gen != best.Gen {
					t.Fatalf("iter %d: valid token %d is not the highest-gen one", it, i)
				}
			} else if apiStatus(err) != 401 {
				t.Fatalf("iter %d login %d: lookup err %v, want 401", it, i, err)
			}
		}
		if valid != 1 {
			t.Fatalf("iter %d: %d valid sessions, want 1", it, valid)
		}
		if len(s.bySession) != 1 {
			t.Fatalf("iter %d: %d indexed sessions, want 1", it, len(s.bySession))
		}
	}
}

// parkFirst installs a testHook that parks the first call for op until
// release is closed, and signals parked when it is parked.
func parkFirst(s *profileStore, op string) (parked <-chan struct{}, release func()) {
	p := make(chan struct{})
	r := make(chan struct{})
	var n atomic.Int32
	s.testHook = func(got string) {
		if got == op && n.Add(1) == 1 {
			close(p)
			<-r
		}
	}
	return p, func() { close(r) }
}

func TestSignUpHookHoldsLock(t *testing.T) {
	s := newRaceStore(t)
	parked, release := parkFirst(s, "signup")
	a := make(chan grantRes, 1)
	go func() { g, err := s.SignUp("ada", "Ada", nil, racePW); a <- grantRes{g, err} }()
	<-parked

	if s.mu.TryLock() {
		s.mu.Unlock()
		t.Fatal("mu is free while the first sign-up is parked in the hook")
	}
	b := make(chan grantRes, 1)
	go func() { g, err := s.SignUp("ADA", "Ada", nil, racePW); b <- grantRes{g, err} }()
	if !stillBlocked(b) {
		t.Fatal("second sign-up returned while the first was parked")
	}
	select {
	case <-a:
		t.Fatal("first sign-up returned while parked")
	default:
	}

	release()
	if r := <-a; r.err != nil {
		t.Fatalf("first sign-up: %v", r.err)
	}
	if r := <-b; r.err != error(errProfileTaken) {
		t.Fatalf("second sign-up: %v, want taken", r.err)
	}
	if len(s.m) != 1 {
		t.Fatalf("%d accounts, want 1", len(s.m))
	}
}

func TestLoginHookHoldsLock(t *testing.T) {
	s := newRaceStore(t)
	signUpAs(t, s, "ada")
	parked, release := parkFirst(s, "login")
	a := make(chan grantRes, 1)
	go func() { g, err := s.Login("ada", racePW); a <- grantRes{g, err} }()
	<-parked

	if s.mu.TryLock() {
		s.mu.Unlock()
		t.Fatal("mu is free while login A is parked in the hook")
	}
	b := make(chan grantRes, 1)
	go func() { g, err := s.Login("ada", racePW); b <- grantRes{g, err} }()
	if !stillBlocked(b) {
		t.Fatal("login B returned while login A was parked")
	}

	release()
	ra, rb := <-a, <-b
	if ra.err != nil || rb.err != nil {
		t.Fatalf("logins failed: %v, %v", ra.err, rb.err)
	}
	if rb.g.Gen <= ra.g.Gen {
		t.Fatalf("B gen %d should exceed A gen %d (A swapped first)", rb.g.Gen, ra.g.Gen)
	}
	if _, _, err := s.Lookup(ra.g.Token); apiStatus(err) != 401 {
		t.Fatalf("A's token: %v, want 401", err)
	}
	if _, gen, err := s.Lookup(rb.g.Token); err != nil || gen != rb.g.Gen {
		t.Fatalf("B's token: gen %d err %v, want valid", gen, err)
	}
}

// With both hash slots taken, a third hashing caller waits for a slot and
// does so without holding s.mu.
func TestPBKDF2LimitedToTwo(t *testing.T) {
	s := newRaceStore(t)
	signUpAs(t, s, "ada")
	if cap(s.sem) != 2 {
		t.Fatalf("cap(sem) = %d, want 2", cap(s.sem))
	}
	for range cap(s.sem) {
		s.sem <- struct{}{} // pretend two hashes are running
	}
	c := make(chan grantRes, 1)
	go func() { g, err := s.Login("ada", racePW); c <- grantRes{g, err} }()
	if !stillBlocked(c) {
		t.Fatal("third hash ran while both slots were taken")
	}
	if !s.mu.TryLock() {
		t.Fatal("s.mu is held while waiting for a hash slot")
	}
	s.mu.Unlock()

	<-s.sem // one hash "finishes"
	if r := <-c; r.err != nil {
		t.Fatalf("login after a slot freed: %v", r.err)
	}
}

func raceBearer(i int) string { return tok(5000 + i) }

func raceCreds(name string) string {
	return `{"username":"` + name + `","password":"` + racePW + `"}`
}

func TestRaceSignUpSameNameHTTP(t *testing.T) {
	for it := range repeatCount() {
		srv, ps, _ := newRaceServer(t)
		res := race(raceN, func(i int) raceResp {
			return fire(srv, "POST", "/api/auth/signup", raceCreds(raceNames[i]), raceBearer(i), "")
		})
		wins := 0
		for i, r := range res {
			switch {
			case r.Err != nil:
				t.Fatalf("iter %d request %d: %v", it, i, r.Err)
			case r.Status == http.StatusCreated:
				wins++
			case r.Status != http.StatusConflict || r.Body != `{"error":"That username is taken."}`+"\n":
				t.Fatalf("iter %d request %d: %d %s, want 409 taken", it, i, r.Status, r.Body)
			}
		}
		if wins != 1 || len(ps.m) != 1 {
			t.Fatalf("iter %d: %d created, %d accounts, want 1 and 1", it, wins, len(ps.m))
		}
	}
}

func TestRaceLoginOneCookieSurvivesHTTP(t *testing.T) {
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		first := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), raceBearer(100), "")
		if first.Status != http.StatusCreated {
			t.Fatalf("iter %d signup: %d %s", it, first.Status, first.Body)
		}
		res := race(raceN, func(i int) raceResp {
			return fire(srv, "POST", "/api/auth/login", raceCreds("ada"), raceBearer(i), "")
		})
		cookies := []string{cookiePair(first.SetCookie)}
		for i, r := range res {
			if r.Status != http.StatusOK || !strings.HasPrefix(r.SetCookie, "cafe_session=") {
				t.Fatalf("iter %d login %d: %d %s %q", it, i, r.Status, r.Body, r.SetCookie)
			}
			cookies = append(cookies, cookiePair(r.SetCookie))
		}
		valid := 0
		for i, c := range cookies {
			switch r := fire(srv, "GET", "/api/account", "", raceBearer(200+i), c); r.Status {
			case http.StatusOK:
				valid++
			case http.StatusUnauthorized:
			default:
				t.Fatalf("iter %d cookie %d: %d %s", it, i, r.Status, r.Body)
			}
		}
		if valid != 1 {
			t.Fatalf("iter %d: %d valid cookies, want 1", it, valid)
		}
	}
}
