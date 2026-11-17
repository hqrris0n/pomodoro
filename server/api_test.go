package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type testEnv struct {
	h   *hub
	clk *fakeClock
	srv *httptest.Server
	dir string
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "public")
	files := map[string]string{
		"public/index.html":   "<html>INDEX</html>",
		"public/assets/x.js":  "console.log(1)",
		"public/favicon.svg":  "<svg/>",
		"secret.txt":          "TOPSECRET",
		"public/assets/y.css": "a{}",
	}
	for name, body := range files {
		p := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h, clk := newTestHub()
	srv := httptest.NewServer(newHandler(h, dir))
	t.Cleanup(srv.Close)
	t.Cleanup(h.CloseStreams)
	return &testEnv{h: h, clk: clk, srv: srv, dir: dir}
}

func (e *testEnv) do(t *testing.T, method, path, token string, body any) (int, string) {
	t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, rd)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, string(out)
}

func createBody(mod func(m map[string]any)) map[string]any {
	m := map[string]any{
		"name": "Ada",
		"settings": map[string]any{"drinkId": "latte", "backgroundId": "window",
			"backgroundRotateMin": 0, "mix": map[string]any{"rain": 0.5}},
		"timer": map[string]any{"focusMs": 1_500_000, "breakMs": 300_000, "rounds": 2,
			"elapsedMs": 0, "anchorAt": nil},
	}
	if mod != nil {
		mod(m)
	}
	return m
}

func sub(m map[string]any, key string) map[string]any { return m[key].(map[string]any) }

func TestCreateValidation(t *testing.T) {
	bigMix := map[string]any{}
	for i := 0; i < 17; i++ {
		bigMix[string(rune('a'+i))] = 0.1
	}
	cases := []struct {
		name string
		mod  func(m map[string]any)
		want int
	}{
		{"valid", nil, 200},
		{"focus 30s", func(m map[string]any) { sub(m, "timer")["focusMs"] = 30_000 }, 400},
		{"focus not whole minutes", func(m map[string]any) { sub(m, "timer")["focusMs"] = 90_000 }, 400},
		{"focus over 3h", func(m map[string]any) { sub(m, "timer")["focusMs"] = 10_860_000 }, 400},
		{"rounds 7", func(m map[string]any) { sub(m, "timer")["rounds"] = 7 }, 400},
		{"break 1", func(m map[string]any) { sub(m, "timer")["breakMs"] = 1 }, 400},
		{"elapsed negative", func(m map[string]any) { sub(m, "timer")["elapsedMs"] = -1 }, 400},
		{"elapsed beyond total", func(m map[string]any) { sub(m, "timer")["elapsedMs"] = 3_300_001 }, 400},
		{"elapsed exactly total", func(m map[string]any) { sub(m, "timer")["elapsedMs"] = 3_300_000 }, 200},
		{"mix 17 keys", func(m map[string]any) { sub(m, "settings")["mix"] = bigMix }, 400},
		{"volume 1.5", func(m map[string]any) { sub(m, "settings")["mix"] = map[string]any{"rain": 1.5} }, 400},
		{"rotate 121", func(m map[string]any) { sub(m, "settings")["backgroundRotateMin"] = 121 }, 400},
		{"drink id 33 chars", func(m map[string]any) { sub(m, "settings")["drinkId"] = strings.Repeat("d", 33) }, 400},
		{"name 25 chars", func(m map[string]any) { m["name"] = strings.Repeat("n", 25) }, 400},
		{"name blank after trim", func(m map[string]any) { m["name"] = "   " }, 400},
		{"unknown field", func(m map[string]any) { m["extra"] = 1 }, 400},
		{"unknown nested field", func(m map[string]any) { sub(m, "timer")["extra"] = 1 }, 400},
		{"missing timer", func(m map[string]any) { delete(m, "timer") }, 400},
	}
	e := newEnv(t)
	for i, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			status, body := e.do(t, "POST", "/api/rooms", tok(i+1), createBody(c.mod))
			if status != c.want {
				t.Fatalf("status %d, want %d: %s", status, c.want, body)
			}
		})
	}
}

func TestRequestRejections(t *testing.T) {
	e := newEnv(t)
	status, _ := e.do(t, "POST", "/api/rooms", tok(1), strings.Repeat("x", 5*1024))
	if status != 400 && status != 413 {
		t.Fatalf("5 KB body: %d", status)
	}
	for _, bad := range []string{"", "short", strings.ToUpper(tok(0xabcdef)), tok(2) + "0", strings.Repeat("g", 32)} {
		if status, _ := e.do(t, "POST", "/api/rooms", bad, createBody(nil)); status != 400 {
			t.Fatalf("token %q: %d", bad, status)
		}
		resp, err := http.Get(e.srv.URL + "/api/events?token=" + bad)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 400 {
			t.Fatalf("stream token %q: %d", bad, resp.StatusCode)
		}
	}
}

func TestRateLimitOverHTTP(t *testing.T) {
	e := newEnv(t)
	for i := 0; i < 20; i++ {
		if status, _ := e.do(t, "PUT", "/api/me", tok(1), map[string]any{"name": "x"}); status != 403 {
			t.Fatalf("request %d: %d", i, status) // 403: valid command, but not in a room
		}
	}
	if status, _ := e.do(t, "PUT", "/api/me", tok(1), map[string]any{"name": "x"}); status != 429 {
		t.Fatalf("21st: %d", status)
	}
}

func TestPermissionStatuses(t *testing.T) {
	e := newEnv(t)
	_, body := e.do(t, "POST", "/api/rooms", tok(1), createBody(nil))
	var room Room
	_ = json.Unmarshal([]byte(body), &room)
	e.do(t, "POST", "/api/rooms/"+room.ID+"/join", tok(2), map[string]any{"name": "Bo"})

	patch := map[string]any{"timer": createBody(nil)["timer"]}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(2), patch); status != 403 {
		t.Fatalf("visitor patch: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/nope", tok(1), patch); status != 404 {
		t.Fatalf("missing room: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(3), patch); status != 403 {
		t.Fatalf("non-member patch: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(1), patch); status != 200 {
		t.Fatalf("owner patch: %d", status)
	}
}

func TestStatic(t *testing.T) {
	e := newEnv(t)
	get := func(path string) (*http.Response, string) {
		resp, err := http.Get(e.srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp, string(b)
	}
	for _, p := range []string{"/", "/some/route", "/index.html"} {
		resp, body := get(p)
		if resp.StatusCode != 200 || !strings.Contains(body, "INDEX") || resp.Header.Get("Cache-Control") != "no-cache" {
			t.Fatalf("%s: %d %q %q", p, resp.StatusCode, body, resp.Header.Get("Cache-Control"))
		}
	}
	resp, _ := get("/assets/x.js")
	if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Fatalf("asset: %d %q", resp.StatusCode, resp.Header.Get("Cache-Control"))
	}
	if resp, _ := get("/favicon.svg"); resp.Header.Get("Cache-Control") != "no-cache" {
		t.Fatal("non-asset must not be immutable")
	}
	for _, p := range []string{"/missing.png", "/assets/nope.js"} {
		if resp, _ := get(p); resp.StatusCode != 404 {
			t.Fatalf("%s: %d", p, resp.StatusCode)
		}
	}
	// A directory is not listed: it falls back to the app shell.
	if resp, body := get("/assets/"); strings.Contains(body, "x.js") && !strings.Contains(body, "INDEX") {
		t.Fatalf("directory listing: %d %q", resp.StatusCode, body)
	}

	resp, body := get("/api/nope")
	if resp.StatusCode != 404 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "application/json") || !strings.Contains(body, `"error"`) {
		t.Fatalf("/api/nope: %d %q", resp.StatusCode, body)
	}
}

// Traversal is tried against the handler directly, since net/http clients and
// the mux would clean most of these paths before they got that far.
func TestStaticCannotEscape(t *testing.T) {
	e := newEnv(t)
	h := newHandler(e.h, e.dir)
	for _, p := range []string{
		"/../secret.txt", "/..%2fsecret.txt", "/assets/../../secret.txt",
		"/%2e%2e/secret.txt", "/..\\secret.txt", "/../etc/passwd", "//secret.txt",
	} {
		req := httptest.NewRequest("GET", "http://x/", nil)
		req.URL.Path = p
		if u, err := req.URL.Parse(p); err == nil && strings.Contains(p, "%") {
			req.URL.Path = u.Path
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if strings.Contains(rec.Body.String(), "TOPSECRET") || strings.Contains(rec.Body.String(), "root:") {
			t.Fatalf("%s escaped: %d", p, rec.Code)
		}
	}
}

// readEvent reads one named SSE event off the wire (ignoring ": ping" comments).
func readEvent(t *testing.T, br *bufio.Reader) (string, map[string]any) {
	t.Helper()
	type result struct {
		name string
		data map[string]any
		err  error
	}
	ch := make(chan result, 1)
	go func() {
		var name string
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				ch <- result{err: err}
				return
			}
			line = strings.TrimRight(line, "\r\n")
			switch {
			case strings.HasPrefix(line, "event: "):
				name = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				var m map[string]any
				err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &m)
				ch <- result{name, m, err}
				return
			}
		}
	}()
	select {
	case r := <-ch:
		if r.err != nil {
			t.Fatal(r.err)
		}
		return r.name, r.data
	case <-time.After(5 * time.Second):
		t.Fatal("timed out reading event")
		return "", nil
	}
}

func TestEndToEndStream(t *testing.T) {
	e := newEnv(t)
	token := tok(0xabc)
	resp, err := http.Get(e.srv.URL + "/api/events?name=Ada&token=" + token)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	hd := resp.Header
	if hd.Get("Content-Type") != "text/event-stream" || hd.Get("Cache-Control") != "no-store" || hd.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("headers: %v", hd)
	}
	br := bufio.NewReader(resp.Body)

	name, data := readEvent(t, br)
	if name != "rooms" || len(data["rooms"].([]any)) != 0 {
		t.Fatalf("first event: %s %v", name, data)
	}
	name, data = readEvent(t, br)
	if name != "room" || data["room"] != nil || data["you"] != memberID(token) {
		t.Fatalf("second event: %s %v", name, data)
	}

	status, body := e.do(t, "POST", "/api/rooms", token, createBody(func(m map[string]any) { delete(m, "name") }))
	if status != 200 {
		t.Fatalf("create: %d %s", status, body)
	}
	var created Room
	_ = json.Unmarshal([]byte(body), &created)

	got := map[string]map[string]any{}
	for len(got) < 2 {
		name, data := readEvent(t, br)
		got[name] = data
	}
	room := got["room"]["room"].(map[string]any)
	if room["id"] != created.ID || room["members"].([]any)[0].(map[string]any)["name"] != "Ada" {
		t.Fatalf("room event: %v", got["room"])
	}
	list := got["rooms"]["rooms"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["ownerName"] != "Ada" {
		t.Fatalf("rooms event: %v", got["rooms"])
	}
	if strings.Contains(body, token) {
		t.Fatal("token in response")
	}
}
