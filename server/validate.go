package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Wire types. They double as the JSON shapes in docs/protocol.md.

type Timer struct {
	FocusMs   int64  `json:"focusMs"`
	BreakMs   int64  `json:"breakMs"`
	Rounds    int    `json:"rounds"`
	ElapsedMs int64  `json:"elapsedMs"`
	AnchorAt  *int64 `json:"anchorAt"`
}

type Settings struct {
	DrinkID             string             `json:"drinkId"`
	BackgroundID        string             `json:"backgroundId"`
	BackgroundRotateMin int                `json:"backgroundRotateMin"`
	Mix                 map[string]float64 `json:"mix"`
}

type Member struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	JoinedAt int64  `json:"joinedAt"`
}

type Room struct {
	ID       string   `json:"id"`
	Settings Settings `json:"settings"`
	Timer    Timer    `json:"timer"`
	Members  []Member `json:"members"`
}

type RoomSummary struct {
	ID          string `json:"id"`
	OwnerName   string `json:"ownerName"`
	MemberCount int    `json:"memberCount"`
	DrinkID     string `json:"drinkId"`
	Timer       Timer  `json:"timer"`
}

const (
	roleHost   = "host"
	roleCohost = "cohost"
	roleGuest  = "guest"

	minFocusMs = 60_000
	maxFocusMs = 10_800_000
	maxRounds  = 6
	maxIDLen   = 32
	maxMixKeys = 16
	maxNameLen = 24
)

// timerIn is what a client sends. AnchorAt is a float so that any JSON number
// is accepted; only its presence matters (the server substitutes its own now).
type timerIn struct {
	FocusMs   int64    `json:"focusMs"`
	BreakMs   int64    `json:"breakMs"`
	Rounds    int      `json:"rounds"`
	ElapsedMs int64    `json:"elapsedMs"`
	AnchorAt  *float64 `json:"anchorAt"`
}

func badRequest(format string, args ...any) *apiError {
	return &apiError{status: 400, msg: fmt.Sprintf(format, args...)}
}

func (t Timer) total() int64 {
	return int64(t.Rounds)*t.FocusMs + int64(t.Rounds-1)*t.BreakMs
}

// validateTimer checks ranges and returns the stored form. A running timer
// (anchorAt non-null) is anchored at the server's nowMs. breakMs is validated
// even when rounds = 1 so stored state is always well formed.
func validateTimer(in timerIn, nowMs int64) (Timer, error) {
	switch {
	case in.FocusMs < minFocusMs || in.FocusMs > maxFocusMs || in.FocusMs%60_000 != 0:
		return Timer{}, badRequest("focusMs must be whole minutes between 1 and 180")
	case in.BreakMs != 300_000 && in.BreakMs != 600_000 && in.BreakMs != 900_000:
		return Timer{}, badRequest("breakMs must be 300000, 600000 or 900000")
	case in.Rounds < 1 || in.Rounds > maxRounds:
		return Timer{}, badRequest("rounds must be 1 to 6")
	}
	t := Timer{FocusMs: in.FocusMs, BreakMs: in.BreakMs, Rounds: in.Rounds, ElapsedMs: in.ElapsedMs}
	if in.ElapsedMs < 0 || in.ElapsedMs > t.total() {
		return Timer{}, badRequest("elapsedMs must be between 0 and the total duration")
	}
	if in.AnchorAt != nil {
		t.AnchorAt = &nowMs
	}
	return t, nil
}

// validateSettings checks sizes and returns a copy with a non-nil mix.
func validateSettings(in Settings) (Settings, error) {
	if utf8.RuneCountInString(in.DrinkID) > maxIDLen || utf8.RuneCountInString(in.BackgroundID) > maxIDLen {
		return Settings{}, badRequest("drinkId and backgroundId must be at most 32 characters")
	}
	if r := in.BackgroundRotateMin; r != 0 && (r < 1 || r > 120) {
		return Settings{}, badRequest("backgroundRotateMin must be 0 or 1 to 120")
	}
	if len(in.Mix) > maxMixKeys {
		return Settings{}, badRequest("mix may have at most 16 channels")
	}
	mix := make(map[string]float64, len(in.Mix))
	for k, v := range in.Mix {
		if utf8.RuneCountInString(k) > maxIDLen || !(v >= 0 && v <= 1) {
			return Settings{}, badRequest("mix channels need short ids and volumes from 0 to 1")
		}
		mix[k] = v
	}
	in.Mix = mix
	return in, nil
}

// validateName trims and checks a display name (1-24 characters).
func validateName(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > maxNameLen {
		return "", badRequest("name must be 1 to 24 characters")
	}
	return s, nil
}

// validToken reports whether s is 32 lowercase hex characters.
func validToken(s string) bool {
	if len(s) != 32 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
