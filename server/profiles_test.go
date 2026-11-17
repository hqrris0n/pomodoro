package main

import (
	"encoding/json"
	"fmt"
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

func pbody(username string, settings any) map[string]any {
	return map[string]any{"username": username, "settings": settings}
}

func decodeProfile(t *testing.T, body string) Profile {
	t.Helper()
	var p Profile
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("bad profile %q: %v", body, err)
	}
	return p
}

func TestProfilesCRUD(t *testing.T) {
	e := newEnv(t)
	code, body := e.do(t, "POST", "/api/profiles", ptok, map[string]any{
		"username": "  Ada ", "settings": map[string]any{"b": 1, "a": []int{1, 2}}})
	if code != 201 {
		t.Fatalf("create: %d %s", code, body)
	}
	p := decodeProfile(t, body)
	if p.Username != "Ada" || p.DisplayName != "Ada" || p.UpdatedAt == 0 || string(p.Settings) != `{"a":[1,2],"b":1}` {
		t.Fatalf("unexpected profile %+v", p)
	}
	e.do(t, "POST", "/api/profiles", ptok, map[string]any{
		"username": "bob", "displayName": "Bobby", "settings": map[string]any{}})

	code, body = e.do(t, "GET", "/api/profiles", ptok, nil)
	if code != 200 || body != `{"profiles":[{"username":"Ada","displayName":"Ada"},{"username":"bob","displayName":"Bobby"}]}`+"\n" {
		t.Fatalf("list: %d %s", code, body)
	}
	code, body = e.do(t, "GET", "/api/profiles/ADA", ptok, nil)
	if code != 200 || decodeProfile(t, body).Username != "Ada" {
		t.Fatalf("get with other case: %d %s", code, body)
	}
	if code, _ = e.do(t, "GET", "/api/profiles/nobody", ptok, nil); code != 404 {
		t.Fatalf("get missing: %d", code)
	}

	first := p.UpdatedAt
	code, body = e.do(t, "PUT", "/api/profiles/ada", ptok, map[string]any{
		"displayName": "Ada L", "settings": map[string]any{"z": true}})
	if code != 200 {
		t.Fatalf("put: %d %s", code, body)
	}
	var up struct{ UpdatedAt int64 }
	_ = json.Unmarshal([]byte(body), &up)
	if up.UpdatedAt <= first {
		t.Fatalf("updatedAt did not increase: %d then %d", first, up.UpdatedAt)
	}
	_, body = e.do(t, "GET", "/api/profiles/Ada", ptok, nil)
	got := decodeProfile(t, body)
	if got.DisplayName != "Ada L" || string(got.Settings) != `{"z":true}` || got.Username != "Ada" || got.UpdatedAt != up.UpdatedAt {
		t.Fatalf("after put: %+v", got)
	}

	if code, body = e.do(t, "DELETE", "/api/profiles/ADA", ptok, nil); code != 200 || body != "{}\n" {
		t.Fatalf("delete: %d %s", code, body)
	}
	if code, _ = e.do(t, "DELETE", "/api/profiles/ada", ptok, nil); code != 404 {
		t.Fatalf("delete missing: %d", code)
	}
}

func TestProfilesRequireToken(t *testing.T) {
	e := newEnv(t)
	if code, _ := e.do(t, "GET", "/api/profiles", "", nil); code != 400 {
		t.Fatalf("no token: %d", code)
	}
}

func TestProfileDuplicateIgnoresCase(t *testing.T) {
	e := newEnv(t)
	e.do(t, "POST", "/api/profiles", ptok, pbody("Ada", map[string]any{}))
	code, body := e.do(t, "POST", "/api/profiles", ptok, pbody("aDA", map[string]any{}))
	if code != 409 || !strings.Contains(body, "that username is taken") {
		t.Fatalf("dup: %d %s", code, body)
	}
}

func TestProfileLimit(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < maxProfiles; i++ {
		e.clk.Advance(rateWindow) // stay under the request rate limit
		if code, body := e.do(t, "POST", "/api/profiles", ptok, pbody(fmt.Sprintf("u%d", i), map[string]any{})); code != 201 {
			t.Fatalf("create %d: %d %s", i, code, body)
		}
	}
	code, body := e.do(t, "POST", "/api/profiles", ptok, pbody("extra", map[string]any{}))
	if code != 429 || !strings.Contains(body, "too many profiles") {
		t.Fatalf("limit: %d %s", code, body)
	}
}

func TestProfileSettingsValidation(t *testing.T) {
	e := newEnv(t)
	for _, raw := range []string{`null`, `[]`, `"x"`, `5`, ``} {
		body := `{"username":"a","settings":` + raw + `}`
		if raw == "" {
			body = `{"username":"a"}`
		}
		if code, out := e.do(t, "POST", "/api/profiles", ptok, body); code != 400 || !strings.Contains(out, "settings must be a JSON object") {
			t.Errorf("settings %q: %d %s", raw, code, out)
		}
	}
	// Just over the limit once compacted.
	big := `{"k":"` + strings.Repeat("x", maxSettingsBytes) + `"}`
	if code, out := e.do(t, "POST", "/api/profiles", ptok, `{"username":"a","settings":`+big+`}`); code != 400 || !strings.Contains(out, "settings too large") {
		t.Errorf("big: %d %s", code, out)
	}
	// Exactly at the limit is fine.
	ok := `{"k":"` + strings.Repeat("x", maxSettingsBytes-8) + `"}`
	if len(ok) != maxSettingsBytes {
		t.Fatalf("test setup: %d", len(ok))
	}
	if code, out := e.do(t, "POST", "/api/profiles", ptok, `{"username":"a","settings":`+ok+`}`); code != 201 {
		t.Errorf("at limit: %d %.100s", code, out)
	}
	// Past the request body limit.
	huge := `{"username":"b","settings":{"k":"` + strings.Repeat("x", profileBodyBytes) + `"}}`
	if code, out := e.do(t, "POST", "/api/profiles", ptok, huge); code != 400 || !strings.Contains(out, "body too large") {
		t.Errorf("huge: %d %s", code, out)
	}
	if code, _ := e.do(t, "PUT", "/api/profiles/a", ptok, `{"displayName":"x"}`); code != 400 {
		t.Errorf("put without settings: %d", code)
	}
	if code, _ := e.do(t, "PUT", "/api/profiles/a", ptok, `{"settings":{}}`); code != 400 {
		t.Errorf("put without displayName: %d", code)
	}
}

func TestProfileBadNames(t *testing.T) {
	e := newEnv(t)
	for name, u := range map[string]string{
		"empty": "", "blank": "   ", "25 chars": strings.Repeat("a", 25), "control": "a\x07b", "newline": "a\nb",
	} {
		if code, body := e.do(t, "POST", "/api/profiles", ptok, pbody(u, map[string]any{})); code != 400 {
			t.Errorf("%s: %d %s", name, code, body)
		}
	}
	if code, _ := e.do(t, "POST", "/api/profiles", ptok, pbody(strings.Repeat("é", 24), map[string]any{})); code != 201 {
		t.Errorf("24 code points should pass")
	}
	if code, _ := e.do(t, "POST", "/api/profiles", ptok, map[string]any{
		"username": "ok", "displayName": " ", "settings": map[string]any{}}); code != 400 {
		t.Errorf("blank displayName should fail")
	}
}

func TestProfileMissing(t *testing.T) {
	e := newEnv(t)
	if code, _ := e.do(t, "PUT", "/api/profiles/none", ptok, map[string]any{"displayName": "x", "settings": map[string]any{}}); code != 404 {
		t.Errorf("put missing: %d", code)
	}
}

func TestProfilePersistence(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "data")
	clk := &fakeClock{t: testHubNow()}
	s := openProfiles(dir, clk.Now, t.Logf)
	if !s.Enabled() {
		t.Fatal("store should be enabled")
	}
	if _, err := s.Create("Ada", "Ada", json.RawMessage(`{"a":1}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("Bob", "Bob", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Put("ada", "Ada L", json.RawMessage(`{"a":2}`)); err != nil {
		t.Fatal(err)
	}
	if err := s.Delete("bob"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Create("Cy", "Cy", json.RawMessage(`{"c":[1]}`)); err != nil {
		t.Fatal(err)
	}
	s2 := openProfiles(dir, clk.Now, t.Logf)
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
	s := openProfiles(dir, testHubNow, t.Logf)
	if _, err := s.Create("Ada", "Ada", json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	s.dir = filepath.Join(dir, "gone") // temp file creation now fails
	if _, err := s.Create("Bob", "Bob", json.RawMessage(`{}`)); err != errProfilesSave {
		t.Fatalf("create: %v", err)
	}
	if _, err := s.Put("Ada", "X", json.RawMessage(`{"x":1}`)); err != errProfilesSave {
		t.Fatalf("put: %v", err)
	}
	if err := s.Delete("Ada"); err != errProfilesSave {
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
		"wrong version":  `{"version":2,"profiles":[]}`,
		"no profiles":    `{"version":1}`,
		"settings array": `{"version":1,"profiles":[{"username":"a","displayName":"a","settings":[],"updatedAt":1}]}`,
		"duplicate":      `{"version":1,"profiles":[{"username":"a","displayName":"a","settings":{},"updatedAt":1},{"username":"A","displayName":"a","settings":{},"updatedAt":1}]}`,
		"trailing":       `{"version":1,"profiles":[]} x`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			e := newEnv(t)
			path := filepath.Join(filepath.Dir(e.dir), "data", profilesFile)
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			e.p = openProfiles(filepath.Dir(path), e.clk.Now, t.Logf)
			e.srv.Config.Handler = newHandler(e.h, e.p, e.dir)
			if e.p.Enabled() {
				t.Fatal("store should be disabled")
			}
			for _, req := range [][2]string{{"GET", "/api/profiles"}, {"GET", "/api/profiles/a"}, {"POST", "/api/profiles"}, {"PUT", "/api/profiles/a"}, {"DELETE", "/api/profiles/a"}} {
				body := any(nil)
				if req[0] == "POST" {
					body = pbody("new", map[string]any{})
				} else if req[0] == "PUT" {
					body = map[string]any{"displayName": "x", "settings": map[string]any{}}
				}
				code, out := e.do(t, req[0], req[1], ptok, body)
				if code != 503 || !strings.Contains(out, "profiles are unavailable") {
					t.Errorf("%v: %d %s", req, code, out)
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
	if openProfiles(filepath.Join(blocker, "sub"), testHubNow, t.Logf).Enabled() {
		t.Fatal("expected disabled store")
	}
}

func TestProfilesConcurrentPut(t *testing.T) {
	e := newEnv(t)
	if code, _ := e.do(t, "POST", "/api/profiles", ptok, pbody("ada", map[string]any{})); code != 201 {
		t.Fatal(code)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	seen := map[int64]bool{}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// The shared rate limit is per token, so each goroutine has its own.
			code, body := e.do(t, "PUT", "/api/profiles/ada", tok(1000+i), map[string]any{
				"displayName": fmt.Sprintf("n%d", i), "settings": map[string]any{"i": i}})
			if code != 200 {
				t.Errorf("put %d: %d %s", i, code, body)
				return
			}
			var up struct{ UpdatedAt int64 }
			_ = json.Unmarshal([]byte(body), &up)
			mu.Lock()
			if seen[up.UpdatedAt] {
				t.Errorf("duplicate updatedAt %d", up.UpdatedAt)
			}
			seen[up.UpdatedAt] = true
			mu.Unlock()
		}()
	}
	wg.Wait()
	s2 := openProfiles(filepath.Join(filepath.Dir(e.dir), "data"), e.clk.Now, t.Logf)
	if !reflect.DeepEqual(e.p.m, s2.m) {
		t.Fatalf("disk differs from memory:\n%+v\n%+v", e.p.m, s2.m)
	}
}
