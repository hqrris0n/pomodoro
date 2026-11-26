package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// Concurrency harness shared by the race tests. race releases n goroutines
// with one close(gate); newRaceServer and fire are the HTTP side.

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
	srv := httptest.NewServer(newHandler(h, ps, static))
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
