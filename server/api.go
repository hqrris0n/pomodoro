package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
)

const maxBodyBytes = 4 << 10

// newAPI returns the /api routes. Unknown /api paths answer 404 JSON and never
// fall through to the static files.
func newAPI(h *hub, p *profileStore, o apiOptions) http.Handler {
	a := &api{h: h, p: p, lim: newLimiter(h.now, o), trustProxy: o.trustProxy}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok\n")
	})
	mux.HandleFunc("GET /api/events", a.events)
	mux.HandleFunc("POST /api/rooms", a.commandLimit(maxSettingsLen, a.create))
	mux.HandleFunc("POST /api/rooms/{id}/join", a.command(a.join))
	mux.HandleFunc("POST /api/rooms/{id}/leave", a.command(a.leave))
	mux.HandleFunc("PATCH /api/rooms/{id}", a.commandLimit(maxSettingsLen, a.patch))
	mux.HandleFunc("POST /api/rooms/{id}/role", a.command(a.setRole))
	mux.HandleFunc("POST /api/rooms/{id}/notes", a.command(a.note))
	mux.HandleFunc("PUT /api/me", a.command(a.rename))
	mux.HandleFunc("POST /api/auth/signup", a.commandLimit(profileBodyBytes, a.signup))
	mux.HandleFunc("POST /api/auth/login", a.command(a.login))
	mux.HandleFunc("POST /api/auth/logout", a.command(a.logout))
	mux.HandleFunc("GET /api/account", a.command(a.getAccount))
	mux.HandleFunc("PUT /api/account", a.commandLimit(profileBodyBytes, a.putAccount))
	mux.HandleFunc("DELETE /api/account", a.command(a.deleteAccount))
	mux.HandleFunc("PUT /api/account/password", a.command(a.changePassword))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, 404, map[string]string{"error": "not found"})
	})
	return mux
}

type api struct {
	h          *hub
	p          *profileStore
	lim        *limiter
	trustProxy bool
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	b, _ := json.Marshal(v)
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(append(b, '\n'))
}

func writeErr(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeJSON(w, ae.status, map[string]string{"error": ae.msg})
		return
	}
	writeJSON(w, 500, map[string]string{"error": "internal error"})
}

// bearerToken extracts and validates the token from the Authorization header.
func bearerToken(r *http.Request) (string, error) {
	tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || !validToken(tok) {
		return "", badRequest("missing or malformed token")
	}
	return tok, nil
}

type commandFunc func(w http.ResponseWriter, r *http.Request, token string) error

// command wraps a handler with token validation, rate limiting and error output.
// The rate limit is charged before the body is parsed so malformed requests count.
func (a *api) command(f commandFunc) http.HandlerFunc {
	return a.commandLimit(maxBodyBytes, f)
}

// commandLimit is command with a custom request body size limit.
func (a *api) commandLimit(limit int64, f commandFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, err := bearerToken(r)
		if err == nil {
			err = a.h.Allow(token)
		}
		if err == nil {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
			err = f(w, r, token)
		}
		if err != nil {
			writeErr(w, err)
		}
	}
}

// decode reads one JSON object, rejecting unknown fields, oversize bodies and
// trailing data.
func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			return badRequest("body too large")
		}
		return badRequest("invalid JSON body")
	}
	if _, err := dec.Token(); err != io.EOF {
		return badRequest("unexpected data after JSON body")
	}
	return nil
}

// optName validates an optional body name; "" means "use the stream's name".
func optName(p *string) (string, error) {
	if p == nil {
		return "", nil
	}
	return validateName(*p)
}

func (a *api) create(w http.ResponseWriter, r *http.Request, token string) error {
	var in struct {
		Name     *string   `json:"name"`
		Settings *Settings `json:"settings"`
		Timer    *timerIn  `json:"timer"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	if in.Settings == nil || in.Timer == nil {
		return badRequest("settings and timer are required")
	}
	name, err := optName(in.Name)
	if err != nil {
		return err
	}
	s, err := validateSettings(*in.Settings)
	if err != nil {
		return err
	}
	t, err := validateTimer(*in.Timer, a.h.nowMs())
	if err != nil {
		return err
	}
	room, err := a.h.CreateRoom(token, name, s, t)
	if err != nil {
		return err
	}
	writeJSON(w, 200, room)
	return nil
}

func (a *api) join(w http.ResponseWriter, r *http.Request, token string) error {
	var in struct {
		Name *string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	name, err := optName(in.Name)
	if err != nil {
		return err
	}
	room, err := a.h.Join(token, r.PathValue("id"), name)
	if err != nil {
		return err
	}
	writeJSON(w, 200, room)
	return nil
}

func (a *api) leave(w http.ResponseWriter, r *http.Request, token string) error {
	if err := a.h.Leave(token, r.PathValue("id")); err != nil {
		return err
	}
	writeJSON(w, 200, struct{}{})
	return nil
}

func (a *api) patch(w http.ResponseWriter, r *http.Request, token string) error {
	// Timer stays raw to tell an absent timer (keep it) from null (clear it).
	var in struct {
		Settings *settingsPatch  `json:"settings"`
		Timer    json.RawMessage `json:"timer"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	clearTimer := string(in.Timer) == "null"
	if in.Settings == nil && len(in.Timer) == 0 {
		return badRequest("nothing to change")
	}
	var s *settingsPatch
	var t *Timer
	if in.Settings != nil {
		v, err := validatePatch(*in.Settings)
		if err != nil {
			return err
		}
		s = &v
	}
	if len(in.Timer) > 0 && !clearTimer {
		var ti timerIn
		dec := json.NewDecoder(bytes.NewReader(in.Timer))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&ti); err != nil {
			return badRequest("invalid JSON body")
		}
		v, err := validateTimer(ti, a.h.nowMs())
		if err != nil {
			return err
		}
		t = &v
	}
	room, err := a.h.Patch(token, r.PathValue("id"), s, t, clearTimer)
	if err != nil {
		return err
	}
	writeJSON(w, 200, room)
	return nil
}

func (a *api) setRole(w http.ResponseWriter, r *http.Request, token string) error {
	var in struct {
		MemberID string `json:"memberId"`
		Role     string `json:"role"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	room, err := a.h.SetRole(token, r.PathValue("id"), in.MemberID, in.Role)
	if err != nil {
		return err
	}
	writeJSON(w, 200, room)
	return nil
}

func (a *api) note(w http.ResponseWriter, r *http.Request, token string) error {
	var in struct {
		To   string `json:"to"`
		Text string `json:"text"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	text, err := validateNoteText(in.Text)
	if err != nil {
		return err
	}
	id, err := a.h.SendNote(token, r.PathValue("id"), in.To, text)
	if err != nil {
		return err
	}
	writeJSON(w, 202, map[string]string{"id": id})
	return nil
}

func (a *api) rename(w http.ResponseWriter, r *http.Request, token string) error {
	var in struct {
		Name string `json:"name"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	name, err := validateName(in.Name)
	if err != nil {
		return err
	}
	if err := a.h.Rename(token, name); err != nil {
		return err
	}
	writeJSON(w, 200, struct{}{})
	return nil
}
