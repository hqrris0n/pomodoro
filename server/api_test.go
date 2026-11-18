package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
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
	p   *profileStore
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
	ps := openProfiles(filepath.Join(root, "data"), clk.Now, t.Logf)
	srv := httptest.NewServer(newHandler(h, ps, dir))
	t.Cleanup(srv.Close)
	t.Cleanup(h.CloseStreams)
	return &testEnv{h: h, clk: clk, srv: srv, dir: dir, p: ps}
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
		t.Fatalf("guest patch: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/nope", tok(1), patch); status != 404 {
		t.Fatalf("missing room: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(3), patch); status != 403 {
		t.Fatalf("non-member patch: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(1), patch); status != 200 {
		t.Fatalf("host patch: %d", status)
	}

	role := func(caller string, role string) int {
		status, _ := e.do(t, "POST", "/api/rooms/"+room.ID+"/role", caller, map[string]any{"memberId": memberID(tok(2)), "role": role})
		return status
	}
	if status := role(tok(2), "cohost"); status != 403 {
		t.Fatalf("guest role: %d", status)
	}
	if status := role(tok(1), "cohost"); status != 200 {
		t.Fatalf("host role: %d", status)
	}
	if status, _ := e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(2), patch); status != 200 {
		t.Fatalf("cohost patch: %d", status)
	}
	if status := role(tok(2), "guest"); status != 403 {
		t.Fatalf("cohost role: %d", status)
	}
}

func TestPatchTimerNullClearsIt(t *testing.T) {
	e := newEnv(t)
	_, body := e.do(t, "POST", "/api/rooms", tok(1), createBody(nil))
	var room Room
	_ = json.Unmarshal([]byte(body), &room)
	e.do(t, "POST", "/api/rooms/"+room.ID+"/join", tok(2), map[string]any{"name": "Bo"})
	path := "/api/rooms/" + room.ID

	// A guest cannot clear it; the host can, and the room keeps both members.
	if status, _ := e.do(t, "PATCH", path, tok(2), `{"timer":null}`); status != 403 {
		t.Fatalf("guest clear: %d", status)
	}
	status, body := e.do(t, "PATCH", path, tok(1), `{"timer": null}`)
	if status != 200 {
		t.Fatalf("host clear: %d %s", status, body)
	}
	var got map[string]any
	_ = json.Unmarshal([]byte(body), &got)
	if v, ok := got["timer"]; !ok || v != nil || got["timerRev"] != 2.0 || len(got["members"].([]any)) != 2 {
		t.Fatalf("after clear: %s", body)
	}
	// An absent timer is kept, not cleared or bumped.
	got = nil
	_, body = e.do(t, "PATCH", path, tok(1), map[string]any{"settings": createBody(nil)["settings"]})
	_ = json.Unmarshal([]byte(body), &got)
	if got["timer"] != nil || got["timerRev"] != 2.0 {
		t.Fatalf("after settings: %s", body)
	}
	// Starting the next timer goes into the same room.
	got = nil
	status, body = e.do(t, "PATCH", path, tok(1), map[string]any{"timer": createBody(nil)["timer"]})
	_ = json.Unmarshal([]byte(body), &got)
	if status != 200 || got["id"] != room.ID || got["timer"] == nil || got["timerRev"] != 3.0 {
		t.Fatalf("restart: %d %s", status, body)
	}
	// Bad timers are still rejected, including unknown fields, and so is an empty patch.
	for _, bad := range []string{`{"timer":{"focusMs":1}}`, `{"timer":{"bogus":1}}`, `{"timer":5}`, `{}`} {
		if status, _ := e.do(t, "PATCH", path, tok(1), bad); status != 400 {
			t.Fatalf("%s: %d", bad, status)
		}
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
	h := newHandler(e.h, e.p, e.dir)
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

func TestNotesOverHTTP(t *testing.T) {
	e := newEnv(t)
	_, body := e.do(t, "POST", "/api/rooms", tok(1), createBody(nil))
	var room Room
	_ = json.Unmarshal([]byte(body), &room)
	e.do(t, "POST", "/api/rooms/"+room.ID+"/join", tok(2), map[string]any{"name": "Bo"})
	path := "/api/rooms/" + room.ID + "/notes"
	to := memberID(tok(2))
	send := func(token, to, text string) int {
		status, _ := e.do(t, "POST", path, token, map[string]any{"to": to, "text": text})
		return status
	}

	resp, err := http.Get(e.srv.URL + "/api/events?token=" + tok(2))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	br := bufio.NewReader(resp.Body)
	readEvent(t, br) // rooms
	readEvent(t, br) // room

	status, out := e.do(t, "POST", path, tok(1), map[string]any{"to": to, "text": "  hi there  "})
	var ok map[string]string
	_ = json.Unmarshal([]byte(out), &ok)
	if status != 202 || len(ok["id"]) != 16 {
		t.Fatalf("send: %d %s", status, out)
	}
	name, data := readEvent(t, br)
	if name != "note" || data["text"] != "hi there" || data["fromName"] != "Ada" || data["id"] != ok["id"] {
		t.Fatalf("event: %s %v", name, data)
	}

	if s := send(tok(9), to, "x"); s != 403 {
		t.Fatalf("non-member sender: %d", s)
	}
	if s := send(tok(1), memberID(tok(9)), "x"); s != 404 {
		t.Fatalf("non-member recipient: %d", s)
	}
	if s := send(tok(1), memberID(tok(1)), "x"); s != 400 {
		t.Fatalf("self: %d", s)
	}
	if s, _ := e.do(t, "POST", "/api/rooms/nope/notes", tok(1), map[string]any{"to": to, "text": "x"}); s != 404 {
		t.Fatalf("no room: %d", s)
	}
	for _, text := range []string{"", "   ", strings.Repeat("a", 141), strings.Repeat("é", 141), "bad\x07bell", "tab\there"} {
		if s := send(tok(1), to, text); s != 400 {
			t.Fatalf("text %q: %d", text, s)
		}
	}
	if s, _ := e.do(t, "POST", path, tok(1), `{"to":"`+to+`","text":"x","extra":1}`); s != 400 {
		t.Fatalf("unknown field: %d", s)
	}
	if s := send(tok(1), to, strings.Repeat("é", 140)); s != 202 {
		t.Fatalf("140 multibyte runes: %d", s)
	}
	if s := send(tok(1), to, "line one\nline two"); s != 202 {
		t.Fatalf("newline: %d", s)
	}

	// 2 notes sent above plus the first one make 3; two more fit, the next does not.
	for i := 0; i < 2; i++ {
		if s := send(tok(1), to, "n"); s != 202 {
			t.Fatalf("note %d: %d", i, s)
		}
	}
	status, out = e.do(t, "POST", path, tok(1), map[string]any{"to": to, "text": "n"})
	if status != 429 || !strings.Contains(out, "error") {
		t.Fatalf("6th note: %d %s", status, out)
	}
	e.clk.Advance(61 * time.Second)
	if s := send(tok(1), to, "n"); s != 202 {
		t.Fatalf("after window: %d", s)
	}
}

func TestRoomBodiesMayCarryFullMixList(t *testing.T) {
	e := newEnv(t)
	mixes := make([]map[string]any, 40)
	for i := range mixes {
		mixes[i] = map[string]any{"id": fmt.Sprintf("%030d-%d", i, i), "name": strings.Repeat("n", 30),
			"mix": map[string]any{"rain": 0.5, "hum": 0.5, "dishes": 0.5, "chatter": 0.5, "espresso": 0.5, "fireplace": 0.5}}
	}
	body := createBody(func(m map[string]any) { sub(m, "settings")["mixes"] = mixes })
	if raw, _ := json.Marshal(body); len(raw) <= 4<<10 {
		t.Fatalf("test body is only %d bytes", len(raw))
	}
	status, out := e.do(t, "POST", "/api/rooms", tok(1), body)
	if status != 200 {
		t.Fatalf("create: %d %s", status, out)
	}
	var room Room
	if err := json.Unmarshal([]byte(out), &room); err != nil {
		t.Fatal(err)
	}
	status, out = e.do(t, "PATCH", "/api/rooms/"+room.ID, tok(1), map[string]any{"settings": sub(body, "settings")})
	if status != 200 {
		t.Fatalf("patch: %d %s", status, out)
	}
}
