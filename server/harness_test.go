package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Concurrency harness shared by the race tests. race releases n goroutines
// with one close(gate); newRaceServer and fire are the HTTP side. openStream
// opens a real SSE stream for one client and keeps its latest `room` and
// `rooms` views, so a test can wait for or inspect what that client sees.

// raceRepeat is how many times each race scenario runs; -short cuts it.
const (
	raceRepeat      = 200
	raceRepeatShort = 20
)

func repeatCount() int {
	if testing.Short() {
		return raceRepeatShort
	}
	return raceRepeat
}

// race starts n goroutines that all wait on one gate. When every goroutine is
// ready, close(gate) releases them together. It returns f's results in index
// order once all have finished.
func race[T any](n int, f func(i int) T) []T {
	gate := make(chan struct{})
	out := make([]T, n)
	var ready, done sync.WaitGroup
	ready.Add(n)
	done.Add(n)
	for i := range n {
		go func() {
			defer done.Done()
			ready.Done()
			<-gate
			out[i] = f(i)
		}()
	}
	ready.Wait()
	close(gate)
	done.Wait()
	return out
}

// newRaceServer starts the real handler on an httptest.Server over a fresh
// temp data dir, with a low PBKDF2 iteration count.
func newRaceServer(t *testing.T) (*httptest.Server, *profileStore, *hub) {
	t.Helper()
	static := t.TempDir()
	if err := os.WriteFile(filepath.Join(static, "index.html"), []byte("<html></html>"), 0o644); err != nil {
		t.Fatal(err)
	}
	h, clk := newTestHub()
	ps := openProfilesIter(filepath.Join(t.TempDir(), "data"), clk.Now, t.Logf, testPBKDF2Iter)
	srv := httptest.NewServer(newHandler(h, ps, static, testOpts))
	t.Cleanup(srv.Close)
	t.Cleanup(h.CloseStreams)
	return srv, ps, h
}

// raceResp is one HTTP response from fire.
type raceResp struct {
	Status    int
	Body      string
	SetCookie string // first Set-Cookie header, "" if none
	Err       error  // transport error; Status is 0 then
}

// fire sends one request. token, if not empty, becomes a Bearer
// Authorization header; cookie, if not empty, becomes the Cookie header.
// It never calls t.Fatal, so it is safe to use from goroutines.
func fire(srv *httptest.Server, method, path, body, token, cookie string) raceResp {
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		return raceResp{Err: err}
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" {
		req.Header.Set("Cookie", cookie)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		return raceResp{Err: err}
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return raceResp{Status: resp.StatusCode, Body: string(b), SetCookie: resp.Header.Get("Set-Cookie"), Err: err}
}

func TestRaceHarnessHealth(t *testing.T) {
	srv, _, _ := newRaceServer(t)
	for i, r := range race(16, func(int) raceResp { return fire(srv, "GET", "/api/health", "", "", "") }) {
		if r.Err != nil || r.Status != http.StatusOK {
			t.Fatalf("request %d: status %d err %v", i, r.Status, r.Err)
		}
	}
}

// raceStream is one open SSE stream. A background goroutine drains it (the
// server drops a stream whose buffer fills) and stores the latest views.
type raceStream struct {
	t *testing.T

	mu       sync.Mutex
	hasRoom  bool   // a room event has arrived
	room     *Room  // latest room view; nil when room is null
	you      string // member id from the latest room event
	rooms    []RoomSummary
	hasRooms bool
	notes    []json.RawMessage
	sessions []json.RawMessage
}

// openStream connects GET /api/events for token and name and returns once the
// server has answered. It is closed (and its goroutine joined) via t.Cleanup.
// Call it from the test goroutine only.
func openStream(t *testing.T, srv *httptest.Server, token, name string) *raceStream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	url := srv.URL + "/api/events?token=" + token + "&name=" + name
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatalf("open stream: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		cancel()
		t.Fatalf("open stream: status %d", resp.StatusCode)
	}
	s := &raceStream{t: t}
	done := make(chan struct{})
	go func() {
		defer close(done)
		defer resp.Body.Close()
		s.read(resp.Body)
	}()
	t.Cleanup(func() {
		cancel()
		resp.Body.Close()
		<-done
	})
	return s
}

// read parses frames until the body ends or errors.
func (s *raceStream) read(r io.Reader) {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1<<20)
	var event, data string
	for sc.Scan() {
		line := sc.Text()
		switch {
		case line == "":
			if event != "" {
				s.apply(event, data)
			}
			event, data = "", ""
		case strings.HasPrefix(line, ":"):
			// comment, e.g. ": ping"
		case strings.HasPrefix(line, "event: "):
			event = line[len("event: "):]
		case strings.HasPrefix(line, "data: "):
			data = line[len("data: "):]
		}
	}
}

func (s *raceStream) apply(event, data string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch event {
	case "room":
		var v struct {
			You  string `json:"you"`
			Room *Room  `json:"room"`
		}
		if err := json.Unmarshal([]byte(data), &v); err != nil {
			s.t.Errorf("bad room event %q: %v", data, err)
			return
		}
		s.hasRoom, s.you, s.room = true, v.You, v.Room
	case "rooms":
		var v struct {
			Rooms []RoomSummary `json:"rooms"`
		}
		if err := json.Unmarshal([]byte(data), &v); err != nil {
			s.t.Errorf("bad rooms event %q: %v", data, err)
			return
		}
		s.hasRooms, s.rooms = true, v.Rooms
	case "note":
		s.notes = append(s.notes, json.RawMessage(data))
	case "session":
		s.sessions = append(s.sessions, json.RawMessage(data))
	}
}

// lastRoom returns the latest room view (nil for none or `room: null`) and
// the member id from `you` ("" before the first room event).
func (s *raceStream) lastRoom() (*Room, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.room, s.you
}

// lastRooms returns the latest `rooms` list, nil before the first event.
func (s *raceStream) lastRooms() []RoomSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rooms
}

// waitRoom polls until the latest room view satisfies ok, which is called
// with nil for `room: null`, and returns that view. On timeout it fails the
// test with the last room seen. Call it from the test goroutine only.
func (s *raceStream) waitRoom(ok func(r *Room) bool, timeout time.Duration) *Room {
	s.t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		s.mu.Lock()
		got, seen := s.room, s.hasRoom
		s.mu.Unlock()
		if seen && ok(got) {
			return got
		}
		if time.Now().After(deadline) {
			last := "no room event yet"
			if seen {
				b, _ := json.Marshal(got)
				last = fmt.Sprintf("last room: %s", b)
			}
			s.t.Fatalf("timed out after %v waiting for room condition; %s", timeout, last)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

func TestRaceHarnessStreams(t *testing.T) {
	srv, _, _ := newRaceServer(t)
	a, b := openStream(t, srv, tok(1), "Ada"), openStream(t, srv, tok(2), "Bo")
	body, _ := json.Marshal(createBody(nil))
	resp := fire(srv, "POST", "/api/rooms", string(body), tok(1), "")
	if resp.Err != nil || resp.Status != http.StatusOK && resp.Status != http.StatusCreated {
		t.Fatalf("create: %d %v %s", resp.Status, resp.Err, resp.Body)
	}
	var created Room
	if err := json.Unmarshal([]byte(resp.Body), &created); err != nil || created.ID == "" {
		t.Fatalf("create body %q: %v", resp.Body, err)
	}
	if r := fire(srv, "POST", "/api/rooms/"+created.ID+"/join", `{"name":"Bo"}`, tok(2), ""); r.Err != nil || r.Status != http.StatusOK {
		t.Fatalf("join: %d %v %s", r.Status, r.Err, r.Body)
	}
	two := func(r *Room) bool { return r != nil && len(r.Members) == 2 }
	a.waitRoom(two, 5*time.Second)
	rb := b.waitRoom(two, 5*time.Second)
	room, you := b.lastRoom()
	if room == nil || room.ID != created.ID || you == "" {
		t.Fatalf("lastRoom = %+v, you %q", room, you)
	}
	found := false
	for _, m := range rb.Members {
		if m.ID == you {
			found = true
			if m.Role != roleGuest {
				t.Fatalf("B role = %q, want guest", m.Role)
			}
		}
	}
	if !found {
		t.Fatalf("B (%s) not in members %+v", you, rb.Members)
	}
}
