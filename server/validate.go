package main

import (
	"fmt"
	"strings"
	"unicode"
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
	// Mixes is the host's saved sound mixes. nil (absent in a request) means
	// "keep the room's list"; views always carry a non-nil list.
	Mixes []SavedMix `json:"mixes"`
}

// SavedMix is one entry of the host's saved list.
type SavedMix struct {
	ID   string             `json:"id"`
	Name string             `json:"name"`
	Mix  map[string]float64 `json:"mix"`
}

type Member struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	JoinedAt int64  `json:"joinedAt"`
}

// Room.Timer and RoomSummary.Timer are null while the host is choosing the
// next order. TimerRev increases every time the timer is replaced or cleared.
type Room struct {
	ID       string   `json:"id"`
	Settings Settings `json:"settings"`
	Timer    *Timer   `json:"timer"`
	TimerRev uint64   `json:"timerRev"`
	Members  []Member `json:"members"`
}

type RoomSummary struct {
	ID          string `json:"id"`
	OwnerName   string `json:"ownerName"`
	MemberCount int    `json:"memberCount"`
	DrinkID     string `json:"drinkId"`
	Timer       *Timer `json:"timer"`
}

// Note is the payload of the `note` SSE event.
type Note struct {
	ID       string `json:"id"`
	RoomID   string `json:"roomId"`
	FromID   string `json:"fromId"`
	FromName string `json:"fromName"`
	Text     string `json:"text"`
	SentAt   int64  `json:"sentAt"`
}

const (
	maxNoteLen = 140

	roleHost   = "host"
	roleCohost = "cohost"
	roleGuest  = "guest"

	minFocusMs = 60_000
	maxFocusMs = 10_800_000
	maxRounds  = 6
	maxIDLen   = 32
	maxMixKeys = 16
	maxNameLen = 24

	maxSavedMixes  = 40
	maxMixIDLen    = 40
	maxMixNameLen  = 30
	maxSettingsLen = 32 << 10 // request body for create and patch, which may carry mixes
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

// validateSettings checks sizes and returns a copy with a non-nil mix (and
// non-nil mixes when the request had them).
func validateSettings(in Settings) (Settings, error) {
	if utf8.RuneCountInString(in.DrinkID) > maxIDLen || utf8.RuneCountInString(in.BackgroundID) > maxIDLen {
		return Settings{}, badRequest("drinkId and backgroundId must be at most 32 characters")
	}
	if r := in.BackgroundRotateMin; r != 0 && (r < 1 || r > 120) {
		return Settings{}, badRequest("backgroundRotateMin must be 0 or 1 to 120")
	}
	mix, err := validateMix(in.Mix)
	if err != nil {
		return Settings{}, err
	}
	in.Mix = mix
	if in.Mixes != nil {
		if len(in.Mixes) > maxSavedMixes {
			return Settings{}, badRequest("mixes may have at most 40 entries")
		}
		seen := make(map[string]bool, len(in.Mixes))
		out := make([]SavedMix, 0, len(in.Mixes))
		for _, m := range in.Mixes {
			if n := utf8.RuneCountInString(m.ID); n < 1 || n > maxMixIDLen || seen[m.ID] {
				return Settings{}, badRequest("mix ids must be unique and 1 to 40 characters")
			}
			seen[m.ID] = true
			if n := utf8.RuneCountInString(m.Name); n < 1 || n > maxMixNameLen {
				return Settings{}, badRequest("mix names must be 1 to 30 characters")
			}
			mm, err := validateMix(m.Mix)
			if err != nil {
				return Settings{}, err
			}
			out = append(out, SavedMix{ID: m.ID, Name: m.Name, Mix: mm})
		}
		in.Mixes = out
	}
	return in, nil
}

// validateMix checks one channel mix and returns a non-nil copy.
func validateMix(in map[string]float64) (map[string]float64, error) {
	if len(in) > maxMixKeys {
		return nil, badRequest("mix may have at most 16 channels")
	}
	mix := make(map[string]float64, len(in))
	for k, v := range in {
		if utf8.RuneCountInString(k) > maxIDLen || !(v >= 0 && v <= 1) {
			return nil, badRequest("mix channels need short ids and volumes from 0 to 1")
		}
		mix[k] = v
	}
	return mix, nil
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

// validateNoteText trims a sticky note and checks it is 1-140 runes. Control
// characters other than newline are rejected, not stripped.
func validateNoteText(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > maxNoteLen {
		return "", badRequest("note must be 1 to 140 characters")
	}
	for _, r := range s {
		if r != '\n' && unicode.IsControl(r) {
			return "", badRequest("note may not contain control characters")
		}
	}
	return s, nil
}
