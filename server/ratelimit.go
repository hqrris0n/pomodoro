package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const (
	limitWindow = time.Minute
	// defaultUserFailures is how many failed password checks one username may
	// have per window; defaultIPAttempts is how many login and sign-up
	// attempts one client address may make per window.
	defaultUserFailures = 5
	defaultIPAttempts   = 20
	// maxLimiterKeys bounds each map. When one is full of live keys the
	// limiter fails closed.
	maxLimiterKeys = 10_000
	maxKeyLen      = 100
)

var errTooManyAttempts = &apiError{429, "Too many attempts. Wait a minute and try again."}

// apiOptions tunes the API. The zero value is the production default except
// that trustProxy is off.
type apiOptions struct {
	// trustProxy reads the client address from the rightmost
	// X-Forwarded-For entry (what the reverse proxy saw).
	trustProxy bool
	// userFailures and ipAttempts override the defaults when positive.
	userFailures, ipAttempts int
}

// limiter counts login and sign-up attempts in rolling windows. It has its own
// mutex, separate from the store and the hub, and is never called with either
// held.
type limiter struct {
	now          func() time.Time
	userFailures int
	ipAttempts   int

	mu    sync.Mutex
	fails map[string][]time.Time // lowercased username -> failed password checks
	ips   map[string][]time.Time // client address -> attempts
}

func newLimiter(now func() time.Time, o apiOptions) *limiter {
	l := &limiter{now: now, userFailures: defaultUserFailures, ipAttempts: defaultIPAttempts,
		fails: map[string][]time.Time{}, ips: map[string][]time.Time{}}
	if o.userFailures > 0 {
		l.userFailures = o.userFailures
	}
	if o.ipAttempts > 0 {
		l.ipAttempts = o.ipAttempts
	}
	return l
}

func limitKey(username string) string {
	k := profileKey(username)
	if len(k) > maxKeyLen {
		k = k[:maxKeyLen]
	}
	return k
}

// recent drops entries older than the window and returns the rest.
func recent(ts []time.Time, now time.Time) []time.Time {
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= limitWindow {
		i++
	}
	return ts[i:]
}

// sweep removes keys with no live entries. Callers hold l.mu.
func (l *limiter) sweep(m map[string][]time.Time, now time.Time) {
	for k, ts := range m {
		if ts = recent(ts, now); len(ts) == 0 {
			delete(m, k)
		} else {
			m[k] = ts
		}
	}
}

// attemptIP records one login or sign-up attempt from ip and reports
// errTooManyAttempts when ip is over its cap.
func (l *limiter) attemptIP(ip string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	ts := recent(l.ips[ip], now)
	if len(ts) >= l.ipAttempts {
		l.ips[ip] = ts
		return errTooManyAttempts
	}
	if _, known := l.ips[ip]; !known && len(l.ips) >= maxLimiterKeys {
		if l.sweep(l.ips, now); len(l.ips) >= maxLimiterKeys {
			return errTooManyAttempts
		}
	}
	l.ips[ip] = append(ts, now)
	return nil
}

// blockedUser reports errTooManyAttempts when username has used up its failed
// attempts. Nothing is recorded.
func (l *limiter) blockedUser(username string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	k := limitKey(username)
	ts := recent(l.fails[k], now)
	if len(ts) == 0 {
		delete(l.fails, k)
	} else {
		l.fails[k] = ts
	}
	if len(ts) >= l.userFailures {
		return errTooManyAttempts
	}
	// Fail closed if the table is full of live keys: new usernames cannot be
	// tracked, so none may be tried.
	if _, known := l.fails[k]; !known && len(l.fails) >= maxLimiterKeys {
		if l.sweep(l.fails, now); len(l.fails) >= maxLimiterKeys {
			return errTooManyAttempts
		}
	}
	return nil
}

// failUser records one failed password check for username.
func (l *limiter) failUser(username string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	k := limitKey(username)
	l.fails[k] = append(recent(l.fails[k], now), now)
}

// clientIP is the address the limits are keyed on: the host part of
// RemoteAddr, or with trustProxy the rightmost X-Forwarded-For entry when
// there is one.
func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		parts := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
		if last := strings.TrimSpace(parts[len(parts)-1]); last != "" {
			return last
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
