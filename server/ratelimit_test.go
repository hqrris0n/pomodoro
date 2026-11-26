package main

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"
)

// limitedEnv serves the default limits.
func limitedEnv(t *testing.T, o apiOptions) *testEnv {
	e := newEnv(t)
	e.srv.Config.Handler = newHandler(e.h, e.p, e.dir, o)
	return e
}

func TestUserFailuresLockLoginsForAMinute(t *testing.T) {
	e := limitedEnv(t, apiOptions{})
	e.signup(t, "ada", "hunter22")
	for i := range 5 {
		if r := e.login(t, " ADA ", "wrongpass1"); r.code != 401 {
			t.Fatalf("failure %d: %d", i, r.code)
		}
	}
	r := e.login(t, "ada", "hunter22")
	if r.code != 429 || r.body != `{"error":"Too many attempts. Wait a minute and try again."}`+"\n" || r.setCookie != "" {
		t.Fatalf("sixth attempt with the right password: %d %s", r.code, r.body)
	}
	e.clk.Advance(61 * time.Second)
	if r := e.login(t, "ada", "hunter22"); r.code != 200 {
		t.Fatalf("after the window: %d %s", r.code, r.body)
	}
}

func TestWrongPasswordOnDeleteCountsAsFailure(t *testing.T) {
	e := limitedEnv(t, apiOptions{})
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	del := func(pw string) int {
		return e.send(t, acctReq{method: "DELETE", path: "/api/account", cookie: cookie, body: map[string]any{"password": pw}}).code
	}
	for range 5 {
		if c := del("wrongpass1"); c != 401 {
			t.Fatal(c)
		}
	}
	if c := del("hunter22"); c != 429 {
		t.Fatalf("delete while locked: %d", c)
	}
	if r := e.login(t, "ada", "hunter22"); r.code != 429 {
		t.Fatalf("login while locked: %d", r.code)
	}
}

func TestIPCapCountsLoginsAndSignups(t *testing.T) {
	e := limitedEnv(t, apiOptions{})
	// Each attempt uses its own device token and username, so only the
	// per-IP cap can answer 429.
	try := func(i int) acctResp {
		path := "/api/auth/login"
		if i%2 == 1 {
			path = "/api/auth/signup"
		}
		return e.send(t, acctReq{method: "POST", path: path, token: tok(3000 + i),
			body: map[string]any{"username": fmt.Sprintf("u%d", i), "password": "hunter22"}})
	}
	for i := range 20 {
		if r := try(i); r.code == 429 {
			t.Fatalf("attempt %d limited", i)
		}
	}
	if r := try(20); r.code != 429 {
		t.Fatalf("21st attempt: %d %s", r.code, r.body)
	}
	e.clk.Advance(time.Minute)
	if r := try(20); r.code != 401 {
		t.Fatalf("after the window: %d", r.code)
	}
}

func TestForwardedForOnlyTrustedBehindProxy(t *testing.T) {
	// attempts sends n logins from different devices and usernames, with the
	// X-Forwarded-For header xff(i), and returns how many were limited.
	attempts := func(e *testEnv, n int, xff func(i int) string) (limited int) {
		for i := range n {
			r := e.send(t, acctReq{method: "POST", path: "/api/auth/login", token: tok(2000 + i), xff: xff(i),
				body: map[string]any{"username": fmt.Sprintf("u%d", i), "password": "hunter22"}})
			if r.code == 429 {
				limited++
			}
		}
		return
	}
	distinct := func(i int) string { return fmt.Sprintf("10.0.0.%d", i) }

	if got := attempts(limitedEnv(t, apiOptions{}), 25, distinct); got != 5 {
		t.Errorf("proxy not trusted: %d limited, want 5 (header must be ignored)", got)
	}
	trusted := apiOptions{trustProxy: true}
	if got := attempts(limitedEnv(t, trusted), 25, distinct); got != 0 {
		t.Errorf("trusted, distinct clients: %d limited, want 0", got)
	}
	// The leftmost entries are client-controlled; only the rightmost counts.
	spoofed := func(i int) string { return fmt.Sprintf("10.0.0.%d, 192.0.2.1", i) }
	if got := attempts(limitedEnv(t, trusted), 25, spoofed); got != 5 {
		t.Errorf("trusted, spoofed prefix: %d limited, want 5", got)
	}
	// A missing or blank header falls back to the connection address.
	if got := attempts(limitedEnv(t, trusted), 25, func(int) string { return " " }); got != 5 {
		t.Errorf("trusted, blank header: %d limited, want 5", got)
	}
}

func TestClientIP(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.9:5555"
	if got := clientIP(r, false); got != "203.0.113.9" {
		t.Fatalf("got %q", got)
	}
	r.RemoteAddr = "[2001:db8::1]:80"
	if got := clientIP(r, true); got != "2001:db8::1" {
		t.Fatalf("v6: got %q", got)
	}
}

func TestLimiterFailsClosedWhenFull(t *testing.T) {
	_, clk := newTestHub()
	l := newLimiter(clk.Now, apiOptions{})
	for i := range maxLimiterKeys {
		if err := l.attemptIP(fmt.Sprintf("ip%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.attemptIP("one-more"); err != error(errTooManyAttempts) {
		t.Fatalf("full table: %v", err)
	}
	if err := l.attemptIP("ip0"); err != nil {
		t.Fatalf("known ip should still be tracked: %v", err)
	}
	clk.Advance(limitWindow)
	if err := l.attemptIP("one-more"); err != nil {
		t.Fatalf("after the window the table is swept: %v", err)
	}
	if len(l.ips) != 1 {
		t.Fatalf("%d keys after sweep, want 1", len(l.ips))
	}
}

func TestWrongPasswordOnChangeCountsAsFailure(t *testing.T) {
	e := limitedEnv(t, apiOptions{})
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	for i := range 5 {
		if r := e.changePassword(t, cookie, "wrongpass1", "newpass99"); r.code != 401 {
			t.Fatalf("failure %d: %d", i, r.code)
		}
	}
	r := e.changePassword(t, cookie, "hunter22", "newpass99")
	if r.code != 429 || r.body != `{"error":"Too many attempts. Wait a minute and try again."}`+"\n" || r.setCookie != "" {
		t.Fatalf("change while locked: %d %s", r.code, r.body)
	}
	if l := e.login(t, "ada", "hunter22"); l.code != 429 {
		t.Fatalf("login while locked: %d", l.code)
	}
}

func TestChangePasswordCountsTowardIPCap(t *testing.T) {
	e := limitedEnv(t, apiOptions{ipAttempts: 3})
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie) // attempt 1
	for i := range 2 {
		if r := e.changePassword(t, cookie, "hunter22", "short"); r.code != 400 {
			t.Fatalf("attempt %d: %d", i+2, r.code)
		}
	}
	if r := e.changePassword(t, cookie, "hunter22", "newpass99"); r.code != 429 {
		t.Fatalf("fourth attempt: %d %s", r.code, r.body)
	}
}
