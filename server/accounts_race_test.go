package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
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

// Kick-out: device A signs up and listens; device B logs in. A's stream hears
// "session: revoked" and A's cookie is dead; B's works.
func TestRaceKickOutHTTP(t *testing.T) {
	devA, devB := raceBearer(1), raceBearer(2)
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), devA, "")
		if a.Status != http.StatusCreated {
			t.Fatalf("iter %d signup: %d %s", it, a.Status, a.Body)
		}
		resp, err := srv.Client().Get(srv.URL + "/api/events?name=Ada&token=" + devA)
		if err != nil {
			t.Fatal(err)
		}
		br := bufio.NewReader(resp.Body)
		readEvent(t, br) // rooms
		readEvent(t, br) // room

		b := fire(srv, "POST", "/api/auth/login", raceCreds("ada"), devB, "")
		if b.Status != http.StatusOK {
			t.Fatalf("iter %d login: %d %s", it, b.Status, b.Body)
		}
		if name, data := readEvent(t, br); name != "session" || data["state"] != "revoked" || data["now"] == nil {
			t.Fatalf("iter %d: A's stream got %s %v", it, name, data)
		}
		resp.Body.Close()
		if r := fire(srv, "GET", "/api/account", "", devA, cookiePair(a.SetCookie)); r.Status != http.StatusUnauthorized {
			t.Fatalf("iter %d: A's account: %d %s", it, r.Status, r.Body)
		}
		if r := fire(srv, "GET", "/api/account", "", devB, cookiePair(b.SetCookie)); r.Status != http.StatusOK {
			t.Fatalf("iter %d: B's account: %d %s", it, r.Status, r.Body)
		}
	}
}

// Room handover under concurrent logins: A hosts; three devices log in at
// once. The one whose session survived is the host, A is a guest, and the
// other two are not the host.
func TestRaceLoginHandoverHTTP(t *testing.T) {
	const n = 3
	devA := raceBearer(100)
	body, _ := json.Marshal(createBody(nil))
	for it := range repeatCount() {
		srv, _, h := newRaceServer(t)
		a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), devA, "")
		c := fire(srv, "POST", "/api/rooms", string(body), devA, "")
		var room Room
		if a.Status != http.StatusCreated || c.Status != http.StatusOK || json.Unmarshal([]byte(c.Body), &room) != nil {
			t.Fatalf("iter %d setup: %d %s / %d %s", it, a.Status, a.Body, c.Status, c.Body)
		}
		res := race(n, func(i int) raceResp {
			return fire(srv, "POST", "/api/auth/login", raceCreds("ada"), raceBearer(i), "")
		})
		winner := -1
		for i, r := range res {
			if r.Status != http.StatusOK {
				t.Fatalf("iter %d login %d: %d %s", it, i, r.Status, r.Body)
			}
			switch got := fire(srv, "GET", "/api/account", "", raceBearer(i), cookiePair(r.SetCookie)); got.Status {
			case http.StatusOK:
				if winner >= 0 {
					t.Fatalf("iter %d: logins %d and %d both valid", it, winner, i)
				}
				winner = i
			case http.StatusUnauthorized:
			default:
				t.Fatalf("iter %d cookie %d: %d %s", it, i, got.Status, got.Body)
			}
		}
		if winner < 0 {
			t.Fatalf("iter %d: no valid session", it)
		}
		got, _ := h.room(room.ID)
		if roleOf(got, raceBearer(winner)) != roleHost || roleOf(got, devA) != roleGuest {
			t.Fatalf("iter %d: winner %d, members %+v", it, winner, got.Members)
		}
		for i := range n {
			if i != winner && roleOf(got, raceBearer(i)) == roleHost {
				t.Fatalf("iter %d: loser %d is host", it, i)
			}
		}
	}
}

// Logging out on the linked device unlinks it: a later login elsewhere sends
// it nothing and leaves its room alone.
func TestLogoutUnlinksDevice(t *testing.T) {
	srv, _, h := newRaceServer(t)
	devA, devB := raceBearer(1), raceBearer(2)
	a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), devA, "")
	body, _ := json.Marshal(createBody(nil))
	c := fire(srv, "POST", "/api/rooms", string(body), devA, "")
	var room Room
	if a.Status != http.StatusCreated || json.Unmarshal([]byte(c.Body), &room) != nil {
		t.Fatalf("setup: %d %s / %d %s", a.Status, a.Body, c.Status, c.Body)
	}
	cn, err := h.Connect(devA, "")
	if err != nil {
		t.Fatal(err)
	}
	if r := fire(srv, "POST", "/api/auth/logout", "", devA, cookiePair(a.SetCookie)); r.Status != http.StatusOK {
		t.Fatalf("logout: %d %s", r.Status, r.Body)
	}
	drain(cn)
	if r := fire(srv, "POST", "/api/auth/login", raceCreds("ada"), devB, ""); r.Status != http.StatusOK {
		t.Fatalf("login: %d %s", r.Status, r.Body)
	}
	if evs := drain(cn); len(evs) != 0 {
		t.Fatalf("logged-out device got %v", namesOf(evs))
	}
	if got, _ := h.room(room.ID); roleOf(got, devA) != roleHost || roleOf(got, devB) != "" {
		t.Fatalf("members %+v", got.Members)
	}
}

func TestReplacedOnlyOverLiveSession(t *testing.T) {
	clk := &fakeClock{t: time.UnixMilli(1_700_000_000_000)}
	s := openProfilesIter(t.TempDir(), clk.Now, t.Logf, testPBKDF2Iter)
	login := func() sessionGrant {
		t.Helper()
		g, err := s.Login("ada", racePW)
		if err != nil {
			t.Fatal(err)
		}
		return g
	}
	if g := signUpAs(t, s, "ada"); g.Replaced {
		t.Fatal("sign-up replaced a session")
	}
	g := login()
	if !g.Replaced {
		t.Fatal("login over a live session: Replaced false")
	}
	if g, err := s.ChangePassword(g.Token, racePW, racePW); err != nil || !g.Replaced {
		t.Fatalf("change password over a live session: %+v %v", g, err)
	}
	g = login()
	if err := s.Logout(g.Token); err != nil {
		t.Fatal(err)
	}
	if login().Replaced {
		t.Fatal("login after logout: Replaced true")
	}
	clk.Advance(sessionTTL)
	if login().Replaced {
		t.Fatal("login after expiry: Replaced true")
	}
}

const racePW2 = "brand new pw"

func cookieValid(srv *httptest.Server, dev int, cookie string) bool {
	return fire(srv, "GET", "/api/account", "", raceBearer(dev), cookie).Status == http.StatusOK
}

func loginStatus(srv *httptest.Server, dev int, pw string) int {
	return fire(srv, "POST", "/api/auth/login", `{"username":"ada","password":"`+pw+`"}`, raceBearer(dev), "").Status
}

func changeBody(cur, next string) string { return `{"current":"` + cur + `","new":"` + next + `"}` }

// Device A changes the password while device B logs in with the old one.
func TestRaceChangePasswordVsLoginHTTP(t *testing.T) {
	var changeWins, loginWins int
	for it := range repeatCount() {
		srv, _, _ := newRaceServer(t)
		a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), raceBearer(1), "")
		if a.Status != http.StatusCreated {
			t.Fatalf("iter %d signup: %d %s", it, a.Status, a.Body)
		}
		res := race(2, func(i int) raceResp {
			if i == 0 {
				return fire(srv, "PUT", "/api/account/password", changeBody(racePW, racePW2), raceBearer(1), cookiePair(a.SetCookie))
			}
			return fire(srv, "POST", "/api/auth/login", raceCreds("ada"), raceBearer(2), "")
		})
		ch, lg := res[0], res[1]
		switch {
		case ch.Status == 200 && lg.Status == 401: // change won
			changeWins++
			if !cookieValid(srv, 1, cookiePair(ch.SetCookie)) || lg.SetCookie != "" {
				t.Fatalf("iter %d: change won but A's new cookie is dead or B got a cookie", it)
			}
			if cookieValid(srv, 1, cookiePair(a.SetCookie)) {
				t.Fatalf("iter %d: A's old cookie still valid", it)
			}
			if loginStatus(srv, 2, racePW) != 401 || loginStatus(srv, 2, racePW2) != 200 {
				t.Fatalf("iter %d: new password not stored", it)
			}
		case ch.Status == 401 && lg.Status == 200: // login won
			loginWins++
			if !cookieValid(srv, 2, cookiePair(lg.SetCookie)) || ch.SetCookie != "" || cookieValid(srv, 1, cookiePair(a.SetCookie)) {
				t.Fatalf("iter %d: login won but sessions are wrong", it)
			}
			if loginStatus(srv, 2, racePW2) != 401 || loginStatus(srv, 2, racePW) != 200 {
				t.Fatalf("iter %d: old password not kept", it)
			}
		default:
			t.Fatalf("iter %d: change %d %s / login %d %s", it, ch.Status, ch.Body, lg.Status, lg.Body)
		}
	}
	t.Logf("change won %d, login won %d", changeWins, loginWins)
}

// The change is parked after its re-check, holding the store lock. B's login
// cannot even snapshot until it finishes, then sees the new hash and fails.
func TestChangePasswordWinsOverLaterLogin(t *testing.T) {
	srv, ps, _ := newRaceServer(t)
	a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), raceBearer(1), "")
	parked, release := parkFirst(ps, "change-password")
	ch := make(chan raceResp, 1)
	go func() {
		ch <- fire(srv, "PUT", "/api/account/password", changeBody(racePW, racePW2), raceBearer(1), cookiePair(a.SetCookie))
	}()
	<-parked
	lg := make(chan raceResp, 1)
	go func() { lg <- fire(srv, "POST", "/api/auth/login", raceCreds("ada"), raceBearer(2), "") }()
	if !stillBlocked(lg) {
		t.Fatal("login returned while the change was parked")
	}
	release()
	c, l := <-ch, <-lg
	if c.Status != 200 || l.Status != 401 || l.Body != `{"error":"Wrong username or password."}`+"\n" {
		t.Fatalf("change %d %s / login %d %s", c.Status, c.Body, l.Status, l.Body)
	}
	if !cookieValid(srv, 1, cookiePair(c.SetCookie)) || cookieValid(srv, 1, cookiePair(a.SetCookie)) {
		t.Fatal("A's rotated cookie should be the only valid one")
	}
	if loginStatus(srv, 2, racePW) != 401 || loginStatus(srv, 2, racePW2) != 200 {
		t.Fatal("new password not stored")
	}
}

// B's login is parked after its re-check. A's change waits for the lock, then
// finds A's session replaced. The hook cannot park A between its snapshot and
// its re-check (it fires only under the lock, after the re-check), so the
// store-level CAS failure of A is not forced here; the handler's own session
// lookup fails first.
func TestLoginWinsOverLaterChangePassword(t *testing.T) {
	srv, ps, _ := newRaceServer(t)
	a := fire(srv, "POST", "/api/auth/signup", raceCreds("ada"), raceBearer(1), "")
	parked, release := parkFirst(ps, "login")
	lg := make(chan raceResp, 1)
	go func() { lg <- fire(srv, "POST", "/api/auth/login", raceCreds("ada"), raceBearer(2), "") }()
	<-parked
	ch := make(chan raceResp, 1)
	go func() {
		ch <- fire(srv, "PUT", "/api/account/password", changeBody(racePW, racePW2), raceBearer(1), cookiePair(a.SetCookie))
	}()
	if !stillBlocked(ch) {
		t.Fatal("change returned while the login was parked")
	}
	release()
	l, c := <-lg, <-ch
	if l.Status != 200 || c.Status != 401 || c.Body != `{"error":"Not signed in."}`+"\n" || c.SetCookie != "" {
		t.Fatalf("login %d %s / change %d %s", l.Status, l.Body, c.Status, c.Body)
	}
	if !cookieValid(srv, 2, cookiePair(l.SetCookie)) || cookieValid(srv, 1, cookiePair(a.SetCookie)) {
		t.Fatal("B's cookie should be the only valid one")
	}
	if loginStatus(srv, 2, racePW2) != 401 || loginStatus(srv, 2, racePW) != 200 {
		t.Fatal("old password not kept")
	}
}
