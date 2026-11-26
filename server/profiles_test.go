package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

var ptok = tok(77)

func testHubNow() time.Time { return time.UnixMilli(1_700_000_000_000) }

// testOpts raises the per-IP cap so tests can make many attempts from
// 127.0.0.1; the rate limit tests build their own handler with the defaults.
var testOpts = apiOptions{ipAttempts: 100_000}

// acctReq is one request for send.
type acctReq struct {
	method, path string
	token        string // Bearer device token; ptok if empty
	cookie       string // Cookie header, e.g. "cafe_session=..."
	xff          string // X-Forwarded-For
	body         any
}

type acctResp struct {
	code      int
	body      string
	setCookie string
}

func (e *testEnv) send(t *testing.T, r acctReq) acctResp {
	t.Helper()
	var rd io.Reader
	switch b := r.body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(r.method, e.srv.URL+r.path, rd)
	if r.token == "" {
		r.token = ptok
	}
	req.Header.Set("Authorization", "Bearer "+r.token)
	if r.cookie != "" {
		req.Header.Set("Cookie", r.cookie)
	}
	if r.xff != "" {
		req.Header.Set("X-Forwarded-For", r.xff)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return acctResp{resp.StatusCode, string(out), resp.Header.Get("Set-Cookie")}
}

// cookiePair turns a Set-Cookie header into the Cookie header a browser sends.
func cookiePair(setCookie string) string { return strings.SplitN(setCookie, ";", 2)[0] }

func (e *testEnv) signup(t *testing.T, username, password string) acctResp {
	t.Helper()
	return e.send(t, acctReq{method: "POST", path: "/api/auth/signup", body: map[string]any{"username": username, "password": password}})
}

func (e *testEnv) login(t *testing.T, username, password string) acctResp {
	t.Helper()
	return e.send(t, acctReq{method: "POST", path: "/api/auth/login", body: map[string]any{"username": username, "password": password}})
}

func (e *testEnv) account(t *testing.T, cookie string) acctResp {
	t.Helper()
	return e.send(t, acctReq{method: "GET", path: "/api/account", cookie: cookie})
}

func decodeProfile(t *testing.T, body string) Profile {
	t.Helper()
	var p Profile
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("bad profile %q: %v", body, err)
	}
	return p
}

func TestSignUpThenReadAndSaveOwnAccount(t *testing.T) {
	e := newEnv(t)
	r := e.send(t, acctReq{method: "POST", path: "/api/auth/signup", body: map[string]any{
		"username": "  Ada ", "password": "hunter22", "settings": map[string]any{"b": 1, "a": []int{1, 2}}}})
	if r.code != 201 {
		t.Fatalf("signup: %d %s", r.code, r.body)
	}
	p := decodeProfile(t, r.body)
	if p.Username != "Ada" || p.DisplayName != "Ada" || p.UpdatedAt == 0 || string(p.Settings) != `{"a":[1,2],"b":1}` {
		t.Fatalf("unexpected profile %+v", p)
	}
	if !strings.HasPrefix(r.setCookie, "cafe_session=") || !strings.HasSuffix(r.setCookie, "; Path=/api; Max-Age=2592000; HttpOnly; Secure; SameSite=Strict") {
		t.Fatalf("Set-Cookie: %q", r.setCookie)
	}
	cookie := cookiePair(r.setCookie)

	g := e.account(t, cookie)
	if g.code != 200 || !reflect.DeepEqual(decodeProfile(t, g.body), p) {
		t.Fatalf("get: %d %s", g.code, g.body)
	}
	if g.setCookie != r.setCookie {
		t.Fatalf("use should re-send the cookie: %q", g.setCookie)
	}

	put := e.send(t, acctReq{method: "PUT", path: "/api/account", cookie: cookie, body: map[string]any{
		"displayName": "Ada L", "settings": map[string]any{"z": true}}})
	var up struct{ UpdatedAt int64 }
	_ = json.Unmarshal([]byte(put.body), &up)
	if put.code != 200 || up.UpdatedAt <= p.UpdatedAt || put.setCookie != r.setCookie {
		t.Fatalf("put: %d %s cookie %q", put.code, put.body, put.setCookie)
	}
	got := decodeProfile(t, e.account(t, cookie).body)
	if got.DisplayName != "Ada L" || string(got.Settings) != `{"z":true}` || got.Username != "Ada" || got.UpdatedAt != up.UpdatedAt {
		t.Fatalf("after put: %+v", got)
	}
}

func TestSignUpDefaultsAndExplicitDisplayName(t *testing.T) {
	e := newEnv(t)
	r := e.send(t, acctReq{method: "POST", path: "/api/auth/signup", body: map[string]any{
		"username": "bob", "password": "hunter22", "displayName": "Bobby"}})
	p := decodeProfile(t, r.body)
	if r.code != 201 || p.DisplayName != "Bobby" || string(p.Settings) != `{}` {
		t.Fatalf("%d %s", r.code, r.body)
	}
}

func TestSignUpErrors(t *testing.T) {
	e := newEnv(t)
	if r := e.signup(t, "Ada", "hunter22"); r.code != 201 {
		t.Fatal(r.code, r.body)
	}
	path := filepath.Join(filepath.Dir(e.dir), "data", profilesFile)
	before, _ := os.ReadFile(path)

	r := e.signup(t, "ADA", "otherpass1")
	if r.code != 409 || r.body != `{"error":"That username is taken."}`+"\n" || r.setCookie != "" {
		t.Fatalf("taken: %d %s %q", r.code, r.body, r.setCookie)
	}
	if after, _ := os.ReadFile(path); string(after) != string(before) {
		t.Fatal("profiles.json changed by a rejected sign-up")
	}
	r = e.signup(t, "bob", "1234567")
	if r.code != 400 || r.body != `{"error":"Password must be at least 8 characters."}`+"\n" {
		t.Fatalf("short password: %d %s", r.code, r.body)
	}
}

func TestSignUpAccountCap(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < maxProfiles; i++ {
		e.clk.Advance(rateWindow) // stay under the device rate limit
		if r := e.signup(t, fmt.Sprintf("u%d", i), "hunter22"); r.code != 201 {
			t.Fatalf("create %d: %d %s", i, r.code, r.body)
		}
	}
	r := e.signup(t, "extra", "hunter22")
	if r.code != 429 || r.body != `{"error":"Too many accounts"}`+"\n" {
		t.Fatalf("limit: %d %s", r.code, r.body)
	}
}

func TestLoginFailuresShareMessageOverHTTP(t *testing.T) {
	e := newEnv(t)
	e.signup(t, "ada", "hunter22")
	a, b := e.login(t, "ada", "wrongpass1"), e.login(t, "nobody", "hunter22")
	want := `{"error":"Wrong username or password."}` + "\n"
	if a.code != 401 || b.code != 401 || a.body != want || b.body != want || a.setCookie != "" {
		t.Fatalf("%d %q / %d %q", a.code, a.body, b.code, b.body)
	}
}

func TestLoginOnAnotherDeviceEndsTheFirstSession(t *testing.T) {
	e := newEnv(t)
	cookieA := cookiePair(e.signup(t, "Ada", "hunter22").setCookie)
	r := e.login(t, "ada", "hunter22")
	if r.code != 200 || decodeProfile(t, r.body).Username != "Ada" {
		t.Fatalf("login: %d %s", r.code, r.body)
	}
	cookieB := cookiePair(r.setCookie)
	if a := e.account(t, cookieA); a.code != 401 || a.body != `{"error":"Not signed in."}`+"\n" {
		t.Fatalf("device A: %d %s", a.code, a.body)
	}
	if b := e.account(t, cookieB); b.code != 200 {
		t.Fatalf("device B: %d %s", b.code, b.body)
	}
}

func TestLogoutClearsCookieAndSession(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	r := e.send(t, acctReq{method: "POST", path: "/api/auth/logout", cookie: cookie})
	if r.code != 200 || r.body != "{}\n" || !strings.Contains(r.setCookie, "cafe_session=;") || !strings.Contains(r.setCookie, "Max-Age=0") {
		t.Fatalf("logout: %d %s %q", r.code, r.body, r.setCookie)
	}
	if a := e.account(t, cookie); a.code != 401 {
		t.Fatalf("old cookie: %d", a.code)
	}
	// Logging out again, or with no cookie at all, still succeeds and clears.
	for _, c := range []string{cookie, ""} {
		if r := e.send(t, acctReq{method: "POST", path: "/api/auth/logout", cookie: c}); r.code != 200 || !strings.Contains(r.setCookie, "Max-Age=0") {
			t.Fatalf("repeat logout with %q: %d %q", c, r.code, r.setCookie)
		}
	}
}

func TestDeleteAccount(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	del := func(pw string) acctResp {
		return e.send(t, acctReq{method: "DELETE", path: "/api/account", cookie: cookie, body: map[string]any{"password": pw}})
	}
	if r := del("wrongpass1"); r.code != 401 || r.body != `{"error":"Wrong password."}`+"\n" || r.setCookie != "" {
		t.Fatalf("wrong password: %d %s", r.code, r.body)
	}
	if a := e.account(t, cookie); a.code != 200 {
		t.Fatalf("account should remain: %d", a.code)
	}
	if r := del("hunter22"); r.code != 200 || r.body != "{}\n" || !strings.Contains(r.setCookie, "Max-Age=0") {
		t.Fatalf("delete: %d %s %q", r.code, r.body, r.setCookie)
	}
	if a := e.account(t, cookie); a.code != 401 {
		t.Fatalf("after delete: %d", a.code)
	}
	if r := e.login(t, "ada", "hunter22"); r.code != 401 {
		t.Fatalf("login after delete: %d", r.code)
	}
}

func TestAccountNeedsValidSession(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	body := map[string]any{"displayName": "x", "settings": map[string]any{}}
	e.clk.Advance(sessionTTL + time.Second)
	for name, c := range map[string]string{"none": "", "unknown": "cafe_session=" + strings.Repeat("0", 64), "expired": cookie} {
		for _, req := range []acctReq{
			{method: "GET", path: "/api/account"},
			{method: "PUT", path: "/api/account", body: body},
			{method: "DELETE", path: "/api/account", body: map[string]any{"password": "hunter22"}},
		} {
			req.cookie = c
			if r := e.send(t, req); r.code != 401 || r.body != `{"error":"Not signed in."}`+"\n" {
				t.Errorf("%s %s %s: %d %s", name, req.method, req.path, r.code, r.body)
			}
		}
	}
	// The per-browser token is still required.
	if code, _ := e.do(t, "GET", "/api/account", "", nil); code != 400 {
		t.Errorf("no device token: %d", code)
	}
}

func TestOldProfileRoutesAreGone(t *testing.T) {
	e := newEnv(t)
	e.signup(t, "ada", "hunter22")
	for _, req := range [][2]string{{"GET", "/api/profiles"}, {"GET", "/api/profiles/ada"}, {"POST", "/api/profiles"}, {"PUT", "/api/profiles/ada"}, {"DELETE", "/api/profiles/ada"}} {
		if code, _ := e.do(t, req[0], req[1], ptok, nil); code != 404 {
			t.Errorf("%v: %d, want 404", req, code)
		}
	}
}

func TestAccountSettingsValidation(t *testing.T) {
	e := newEnv(t)
	signup := func(raw string) acctResp {
		body := `{"username":"a","password":"hunter22","settings":` + raw + `}`
		return e.send(t, acctReq{method: "POST", path: "/api/auth/signup", body: body})
	}
	for _, raw := range []string{`null`, `[]`, `"x"`, `5`} {
		if r := signup(raw); r.code != 400 || !strings.Contains(r.body, "settings must be a JSON object") {
			t.Errorf("settings %q: %d %s", raw, r.code, r.body)
		}
	}
	// Just over the limit once compacted.
	big := `{"k":"` + strings.Repeat("x", maxSettingsBytes) + `"}`
	if r := signup(big); r.code != 400 || !strings.Contains(r.body, "settings too large") {
		t.Errorf("big: %d %s", r.code, r.body)
	}
	// Exactly at the limit is fine.
	ok := `{"k":"` + strings.Repeat("x", maxSettingsBytes-8) + `"}`
	r := signup(ok)
	if r.code != 201 {
		t.Fatalf("at limit: %d %.100s", r.code, r.body)
	}
	cookie := cookiePair(r.setCookie)
	// Past the request body limit.
	huge := `{"displayName":"x","settings":{"k":"` + strings.Repeat("x", profileBodyBytes) + `"}}`
	if r := e.send(t, acctReq{method: "PUT", path: "/api/account", cookie: cookie, body: huge}); r.code != 400 || !strings.Contains(r.body, "body too large") {
		t.Errorf("huge: %d %s", r.code, r.body)
	}
	for _, body := range []string{`{"displayName":"x"}`, `{"settings":{}}`} {
		if r := e.send(t, acctReq{method: "PUT", path: "/api/account", cookie: cookie, body: body}); r.code != 400 {
			t.Errorf("put %s: %d", body, r.code)
		}
	}
}

func TestSignUpBadNames(t *testing.T) {
	e := newEnv(t)
	for name, u := range map[string]string{
		"empty": "", "blank": "   ", "25 chars": strings.Repeat("a", 25), "control": "a\x07b", "newline": "a\nb",
	} {
		if r := e.signup(t, u, "hunter22"); r.code != 400 {
			t.Errorf("%s: %d %s", name, r.code, r.body)
		}
	}
	if r := e.signup(t, strings.Repeat("é", 24), "hunter22"); r.code != 201 {
		t.Errorf("24 code points should pass: %d", r.code)
	}
	r := e.send(t, acctReq{method: "POST", path: "/api/auth/signup", body: map[string]any{
		"username": "ok", "password": "hunter22", "displayName": " "}})
	if r.code != 400 {
		t.Errorf("blank displayName should fail: %d", r.code)
	}
}

func TestProfilePersistence(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "data")
	clk := &fakeClock{t: testHubNow()}
	s := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	if !s.Enabled() {
		t.Fatal("store should be enabled")
	}
	ada, err := s.SignUp("Ada", "Ada", json.RawMessage(`{"a":1}`), "password1")
	if err != nil {
		t.Fatal(err)
	}
	bob, err := s.SignUp("Bob", "Bob", json.RawMessage(`{}`), "password1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put(ada.Token, "Ada L", json.RawMessage(`{"a":2}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete(bob.Token, "password1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SignUp("Cy", "Cy", json.RawMessage(`{"c":[1]}`), "password1"); err != nil {
		t.Fatal(err)
	}
	s2 := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	if !s2.Enabled() || !reflect.DeepEqual(s.m, s2.m) || len(s2.m) != 2 {
		t.Fatalf("round trip mismatch:\n%+v\n%+v", s.m, s2.m)
	}
	tmps, _ := filepath.Glob(filepath.Join(dir, "*.tmp"))
	if len(tmps) != 0 {
		t.Fatalf("leftover temp files: %v", tmps)
	}
	if ents, _ := os.ReadDir(dir); len(ents) != 1 {
		t.Fatalf("expected only profiles.json, got %v", ents)
	}
}

func TestProfileSaveFailureRollsBack(t *testing.T) {
	dir := t.TempDir()
	s := openProfilesIter(dir, testHubNow, t.Logf, testPBKDF2Iter)
	ada, err := s.SignUp("Ada", "Ada", json.RawMessage(`{}`), "password1")
	if err != nil {
		t.Fatal(err)
	}
	s.dir = filepath.Join(dir, "gone") // temp file creation now fails
	if _, err := s.SignUp("Bob", "Bob", json.RawMessage(`{}`), "password1"); err != errProfilesSave {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.Put(ada.Token, "X", json.RawMessage(`{"x":1}`)); err != errProfilesSave {
		t.Fatalf("put: %v", err)
	}
	if err := s.Delete(ada.Token, "password1"); err != errProfilesSave {
		t.Fatalf("delete: %v", err)
	}
	if len(s.m) != 1 || s.m["ada"].DisplayName != "Ada" {
		t.Fatalf("not rolled back: %+v", s.m)
	}
}

func TestProfileCorruptFileDisables(t *testing.T) {
	cases := map[string]string{
		"invalid json":   `{not json`,
		"wrong shape":    `[1,2]`,
		"wrong version":  `{"version":3,"profiles":[]}`,
		"no profiles":    `{"version":1}`,
		"settings array": `{"version":1,"profiles":[{"username":"a","displayName":"a","settings":[],"updatedAt":1}]}`,
		"duplicate":      `{"version":1,"profiles":[{"username":"a","displayName":"a","settings":{},"updatedAt":1},{"username":"A","displayName":"a","settings":{},"updatedAt":1}]}`,
		"trailing":       `{"version":1,"profiles":[]} x`,
		"v2 bad hash":    `{"version":2,"profiles":[{"username":"a","displayName":"a","settings":{},"updatedAt":1,"passwordHash":"x","sessionHash":"","sessionExpires":0,"sessionGen":0}]}`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			path := filepath.Join(filepath.Dir(e.dir), "data", profilesFile)
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			e.p = openProfilesIter(filepath.Dir(path), e.clk.Now, t.Logf, testPBKDF2Iter)
			e.srv.Config.Handler = newHandler(e.h, e.p, e.dir, testOpts)
			if e.p.Enabled() {
				t.Fatal("store should be disabled")
			}
			cred := map[string]any{"username": "a", "password": "hunter22"}
			for _, req := range []acctReq{
				{method: "POST", path: "/api/auth/signup", body: cred},
				{method: "POST", path: "/api/auth/login", body: cred},
				{method: "POST", path: "/api/auth/logout"},
				{method: "GET", path: "/api/account"},
				{method: "PUT", path: "/api/account", body: map[string]any{"displayName": "x", "settings": map[string]any{}}},
				{method: "DELETE", path: "/api/account", body: map[string]any{"password": "hunter22"}},
			} {
				r := e.send(t, req)
				if r.code != 503 || !strings.Contains(r.body, "profiles are unavailable") {
					t.Errorf("%s %s: %d %s", req.method, req.path, r.code, r.body)
				}
			}
			after, _ := os.ReadFile(path)
			if string(after) != content {
				t.Fatalf("file changed: %q", after)
			}
			if ents, _ := os.ReadDir(filepath.Dir(path)); len(ents) != 1 {
				t.Fatalf("extra files: %v", ents)
			}
		})
	}
}

func TestProfilesUnusableDirDisables(t *testing.T) {
	blocker := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(blocker, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if openProfilesIter(filepath.Join(blocker, "sub"), testHubNow, t.Logf, testPBKDF2Iter).Enabled() {
		t.Fatal("expected disabled store")
	}
}

func TestAccountConcurrentPut(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	var wg sync.WaitGroup
	var mu sync.Mutex
	seen := map[int64]bool{}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// The shared rate limit is per token, so each goroutine has its own.
			r := e.send(t, acctReq{method: "PUT", path: "/api/account", token: tok(1000 + i), cookie: cookie, body: map[string]any{
				"displayName": fmt.Sprintf("n%d", i), "settings": map[string]any{"i": i}}})
			if r.code != 200 {
				t.Errorf("put %d: %d %s", i, r.code, r.body)
				return
			}
			var up struct{ UpdatedAt int64 }
			_ = json.Unmarshal([]byte(r.body), &up)
			mu.Lock()
			if seen[up.UpdatedAt] {
				t.Errorf("duplicate updatedAt %d", up.UpdatedAt)
			}
			seen[up.UpdatedAt] = true
			mu.Unlock()
		}()
	}
	wg.Wait()
	s2 := openProfilesIter(filepath.Join(filepath.Dir(e.dir), "data"), e.clk.Now, t.Logf, testPBKDF2Iter)
	if !reflect.DeepEqual(e.p.m, s2.m) {
		t.Fatalf("disk differs from memory:\n%+v\n%+v", e.p.m, s2.m)
	}
}

// testPBKDF2Iter keeps hashing fast in tests.
const testPBKDF2Iter = 1000

func wantAPIErr(t *testing.T, err error, status int, msg string) {
	t.Helper()
	ae, ok := err.(*apiError)
	if !ok || ae.status != status || ae.msg != msg {
		t.Fatalf("got error %v, want %d %q", err, status, msg)
	}
}

func TestAccountsMigrateVersion1(t *testing.T) {
	dir := t.TempDir()
	v1 := `{"version":1,"profiles":[` +
		`{"username":"Ada","displayName":"Ada L","settings":{"a":1},"updatedAt":5},` +
		`{"username":"bob","displayName":"Bobby","settings":{},"updatedAt":7}]}`
	if err := os.WriteFile(filepath.Join(dir, profilesFile), []byte(v1), 0o600); err != nil {
		t.Fatal(err)
	}
	clk := &fakeClock{t: testHubNow()}
	s := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	if !s.Enabled() {
		t.Fatal("store should be enabled")
	}
	want := map[string]Profile{
		"ada": {Username: "Ada", DisplayName: "Ada L", Settings: json.RawMessage(`{"a":1}`), UpdatedAt: 5},
		"bob": {Username: "bob", DisplayName: "Bobby", Settings: json.RawMessage(`{}`), UpdatedAt: 7},
	}
	for name, p := range want {
		g, err := s.Login(strings.ToUpper(name), migratedPassword)
		if err != nil {
			t.Fatalf("login %s: %v", name, err)
		}
		if !reflect.DeepEqual(g.Profile, p) || g.Token == "" || g.Gen != 1 {
			t.Fatalf("login %s: %+v", name, g)
		}
	}
	raw, _ := os.ReadFile(filepath.Join(dir, profilesFile))
	var head struct{ Version int }
	if err := json.Unmarshal(raw, &head); err != nil || head.Version != 2 {
		t.Fatalf("written file: %v %s", err, raw)
	}
	s2 := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	if _, err := s2.Login("bob", migratedPassword); err != nil {
		t.Fatalf("login after rewrite: %v", err)
	}
	if _, err := s2.Login("bob", "wrongpass"); err == nil {
		t.Fatal("wrong password accepted")
	}
}

func TestSignUpTakenIgnoresCaseAndKeepsFile(t *testing.T) {
	dir := t.TempDir()
	s := openProfilesIter(dir, testHubNow, t.Logf, testPBKDF2Iter)
	if _, err := s.SignUp("ada", "ada", json.RawMessage(`{}`), "password1"); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(filepath.Join(dir, profilesFile))
	_, err := s.SignUp("ADA", "ADA", json.RawMessage(`{}`), "password2")
	wantAPIErr(t, err, 409, "That username is taken.")
	after, _ := os.ReadFile(filepath.Join(dir, profilesFile))
	if string(before) != string(after) {
		t.Fatal("file changed")
	}
}

func TestAccountCap(t *testing.T) {
	s := openProfilesIter(t.TempDir(), testHubNow, t.Logf, testPBKDF2Iter)
	for i := 0; i < 50; i++ {
		if _, err := s.SignUp(fmt.Sprintf("u%d", i), "u", json.RawMessage(`{}`), "password1"); err != nil {
			t.Fatalf("sign-up %d: %v", i, err)
		}
	}
	_, err := s.SignUp("extra", "extra", json.RawMessage(`{}`), "password1")
	wantAPIErr(t, err, 429, "Too many accounts")
}

func TestLoginFailuresShareMessage(t *testing.T) {
	s := openProfilesIter(t.TempDir(), testHubNow, t.Logf, testPBKDF2Iter)
	if _, err := s.SignUp("ada", "ada", json.RawMessage(`{}`), "password1"); err != nil {
		t.Fatal(err)
	}
	_, err := s.Login("ada", "password2")
	wantAPIErr(t, err, 401, "Wrong username or password.")
	_, err = s.Login("nobody", "password1")
	wantAPIErr(t, err, 401, "Wrong username or password.")
}

func TestLoginReplacesSession(t *testing.T) {
	s := openProfilesIter(t.TempDir(), testHubNow, t.Logf, testPBKDF2Iter)
	up, err := s.SignUp("Ada", "Ada", json.RawMessage(`{}`), "password1")
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.Login("ada", "password1")
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.Login("ADA", "password1")
	if err != nil {
		t.Fatal(err)
	}
	if b.Profile.Username != "Ada" || !(up.Gen < a.Gen && a.Gen < b.Gen) {
		t.Fatalf("grants: %+v %+v %+v", up, a, b)
	}
	for _, old := range []string{up.Token, a.Token} {
		_, _, err := s.Lookup(old)
		wantAPIErr(t, err, 401, errNoSession.msg)
	}
	p, gen, err := s.Lookup(b.Token)
	if err != nil || p.Username != "Ada" || gen != b.Gen {
		t.Fatalf("lookup B: %+v %d %v", p, gen, err)
	}
}

func TestSessionSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	clk := &fakeClock{t: testHubNow()}
	s := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	g, err := s.SignUp("ada", "ada", json.RawMessage(`{}`), "password1")
	if err != nil {
		t.Fatal(err)
	}
	s2 := openProfilesIter(dir, clk.Now, t.Logf, testPBKDF2Iter)
	if p, gen, err := s2.Lookup(g.Token); err != nil || p.Username != "ada" || gen != g.Gen {
		t.Fatalf("after restart: %+v %d %v", p, gen, err)
	}
}

func TestPasswordHashFormat(t *testing.T) {
	s := openProfilesIter(t.TempDir(), testHubNow, t.Logf, testPBKDF2Iter)
	h, err := s.hashPassword("password1")
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(h, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" || parts[1] != "1000" {
		t.Fatalf("format: %q", h)
	}
	iter, salt, key, err := parsePasswordHash(h)
	if err != nil || iter != 1000 || len(salt) != 16 || len(key) != 32 {
		t.Fatalf("parse: %d %d %d %v", iter, len(salt), len(key), err)
	}
	if formatPasswordHash(iter, salt, key) != h {
		t.Fatal("format does not round-trip")
	}
	// A store hashing with a different count still checks old hashes.
	s2 := openProfilesIter(t.TempDir(), testHubNow, t.Logf, 2000)
	if !s2.verifyPassword(h, "password1") || s2.verifyPassword(h, "password2") {
		t.Fatal("verify uses the stored iteration count")
	}
}

func TestPasswordLength(t *testing.T) {
	s := openProfilesIter(t.TempDir(), testHubNow, t.Logf, testPBKDF2Iter)
	cases := []struct {
		pw  string
		err error
	}{
		{strings.Repeat("a", 7), errPasswordShort},
		{strings.Repeat("é", 7), errPasswordShort}, // 14 bytes, 7 code points
		{strings.Repeat("a", 8), nil},
		{strings.Repeat("é", 72), nil},
		{strings.Repeat("a", 73), errPasswordLong},
	}
	for i, c := range cases {
		_, err := s.SignUp(fmt.Sprintf("u%d", i), "u", json.RawMessage(`{}`), c.pw)
		if err != c.err {
			t.Errorf("%d code points: got %v, want %v", len([]rune(c.pw)), err, c.err)
		}
	}
	wantAPIErr(t, errPasswordShort, 400, "Password must be at least 8 characters.")
	wantAPIErr(t, errPasswordLong, 400, "Password must be at most 72 characters.")
}

func (e *testEnv) changePassword(t *testing.T, cookie, current, next string) acctResp {
	t.Helper()
	return e.send(t, acctReq{method: "PUT", path: "/api/account/password", cookie: cookie, body: map[string]any{"current": current, "new": next}})
}

func TestChangePasswordRotatesSession(t *testing.T) {
	e := newEnv(t)
	old := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	r := e.changePassword(t, old, "hunter22", "newpass99")
	fresh := cookiePair(r.setCookie)
	if r.code != 200 || r.body != "{}\n" || !strings.HasPrefix(fresh, "cafe_session=") || fresh == old {
		t.Fatalf("change: %d %s %q", r.code, r.body, r.setCookie)
	}
	if a := e.account(t, old); a.code != 401 || a.body != `{"error":"Not signed in."}`+"\n" {
		t.Fatalf("old cookie: %d %s", a.code, a.body)
	}
	if a := e.account(t, fresh); a.code != 200 {
		t.Fatalf("new cookie: %d %s", a.code, a.body)
	}
	if l := e.login(t, "ada", "hunter22"); l.code != 401 || l.body != `{"error":"Wrong username or password."}`+"\n" {
		t.Fatalf("login with old password: %d %s", l.code, l.body)
	}
	if l := e.login(t, "ada", "newpass99"); l.code != 200 {
		t.Fatalf("login with new password: %d %s", l.code, l.body)
	}
}

func TestChangePasswordRejections(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	cases := []struct {
		name, current, next string
		code                int
		msg                 string
	}{
		{"wrong current", "wrongpass1", "newpass99", 401, "Wrong password."},
		{"short new", "hunter22", strings.Repeat("a", 7), 400, "Password must be at least 8 characters."},
		{"long new", "hunter22", strings.Repeat("a", 73), 400, "Password must be at most 72 characters."},
	}
	for _, c := range cases {
		r := e.changePassword(t, cookie, c.current, c.next)
		if r.code != c.code || r.body != `{"error":"`+c.msg+`"}`+"\n" || r.setCookie != "" {
			t.Errorf("%s: %d %s %q", c.name, r.code, r.body, r.setCookie)
		}
	}
	if a := e.account(t, cookie); a.code != 200 {
		t.Fatalf("session changed: %d", a.code)
	}
	if l := e.login(t, "ada", "hunter22"); l.code != 200 {
		t.Fatalf("password changed: %d %s", l.code, l.body)
	}
}

func TestChangePasswordNeedsValidSession(t *testing.T) {
	e := newEnv(t)
	e.signup(t, "ada", "hunter22")
	for name, c := range map[string]string{"none": "", "dead": "cafe_session=" + strings.Repeat("0", 64)} {
		r := e.changePassword(t, c, "hunter22", "newpass99")
		if r.code != 401 || r.body != `{"error":"Not signed in."}`+"\n" || r.setCookie != "" {
			t.Errorf("%s: %d %s", name, r.code, r.body)
		}
	}
	if l := e.login(t, "ada", "hunter22"); l.code != 200 {
		t.Fatalf("password changed: %d", l.code)
	}
}

// The device keeps its link and room: the new session is the same device's,
// so nothing is revoked or handed over.
func TestChangePasswordKeepsDeviceLinkAndRoom(t *testing.T) {
	e := newEnv(t)
	cookie := cookiePair(e.signup(t, "ada", "hunter22").setCookie)
	body, _ := json.Marshal(createBody(nil))
	c := e.send(t, acctReq{method: "POST", path: "/api/rooms", body: string(body)})
	var room Room
	if c.code != 200 || json.Unmarshal([]byte(c.body), &room) != nil {
		t.Fatalf("create room: %d %s", c.code, c.body)
	}
	cn, err := e.h.Connect(ptok, "")
	if err != nil {
		t.Fatal(err)
	}
	drain(cn)
	if r := e.changePassword(t, cookie, "hunter22", "newpass99"); r.code != 200 {
		t.Fatalf("change: %d %s", r.code, r.body)
	}
	if evs := drain(cn); len(evs) != 0 {
		t.Fatalf("device got %v", namesOf(evs))
	}
	if got, _ := e.h.room(room.ID); roleOf(got, ptok) != roleHost {
		t.Fatalf("members %+v", got.Members)
	}
	// Still linked at the new gen: a later login elsewhere revokes this device.
	if l := e.send(t, acctReq{method: "POST", path: "/api/auth/login", token: tok(78), body: map[string]any{"username": "ada", "password": "newpass99"}}); l.code != 200 {
		t.Fatalf("login: %d %s", l.code, l.body)
	}
	if evs := drain(cn); len(evs) == 0 || evs[0].name != "session" {
		t.Fatalf("after other login: %v", namesOf(evs))
	}
}
