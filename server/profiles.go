package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	maxProfiles      = 20
	maxSettingsBytes = 256 << 10
	// profileBodyBytes leaves room for the envelope around maximal settings.
	profileBodyBytes = maxSettingsBytes + 4<<10
	profilesFile     = "profiles.json"
)

var (
	errNoProfile      = &apiError{404, "no such profile"}
	errProfileTaken   = &apiError{409, "that username is taken"}
	errProfilesFull   = &apiError{429, "too many profiles"}
	errProfilesOff    = &apiError{503, "profiles are unavailable"}
	errProfilesSave   = &apiError{500, "could not save profiles"}
	errSettingsObject = badRequest("settings must be a JSON object")
)

// Profile is the stored and wire form of one user's saved settings.
type Profile struct {
	Username    string          `json:"username"`
	DisplayName string          `json:"displayName"`
	Settings    json.RawMessage `json:"settings"`
	UpdatedAt   int64           `json:"updatedAt"`
}

type profileSummary struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
}

type profilesDisk struct {
	Version  int       `json:"version"`
	Profiles []Profile `json:"profiles"`
}

// profileStore keeps all profiles in memory and in <dir>/profiles.json. If the
// file cannot be read or is corrupt the store is disabled and never writes, so
// the file stays exactly as found.
type profileStore struct {
	mu       sync.Mutex
	path     string
	dir      string
	now      func() time.Time
	disabled bool
	m        map[string]Profile // keyed by lowercased username
}

func profileKey(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

func validateUsername(s string) (string, error) {
	s = strings.TrimSpace(s)
	if n := utf8.RuneCountInString(s); n < 1 || n > maxNameLen {
		return "", badRequest("username must be 1 to 24 characters")
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return "", badRequest("username may not contain control characters")
		}
	}
	return s, nil
}

// validateProfileSettings checks that raw is a JSON object within the size
// limit and returns it compacted.
func validateProfileSettings(raw json.RawMessage) (json.RawMessage, error) {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 || t[0] != '{' {
		return nil, errSettingsObject
	}
	var probe map[string]json.RawMessage
	if json.Unmarshal(t, &probe) != nil || probe == nil {
		return nil, errSettingsObject
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, t); err != nil {
		return nil, errSettingsObject
	}
	if buf.Len() > maxSettingsBytes {
		return nil, badRequest("settings too large")
	}
	return buf.Bytes(), nil
}

// openProfiles loads the store from dir. Problems disable the store rather
// than fail, so the rest of the server keeps working.
func openProfiles(dir string, now func() time.Time, logf func(format string, args ...any)) *profileStore {
	s := &profileStore{dir: dir, path: filepath.Join(dir, profilesFile), now: now, m: map[string]Profile{}}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logf("profiles disabled: %v", err)
		s.disabled = true
		return s
	}
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s
	}
	if err == nil {
		err = s.parse(raw)
	}
	if err != nil {
		logf("profiles disabled: %s: %v", s.path, err)
		s.disabled = true
		s.m = map[string]Profile{}
	}
	return s
}

func (s *profileStore) parse(raw []byte) error {
	var d profilesDisk
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&d); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("unexpected data after JSON")
	}
	if d.Version != 1 || d.Profiles == nil {
		return errors.New("unsupported or missing version/profiles")
	}
	for _, p := range d.Profiles {
		u, err := validateUsername(p.Username)
		if err != nil || u != p.Username {
			return errors.New("invalid username " + p.Username)
		}
		if _, err := validateName(p.DisplayName); err != nil {
			return errors.New("invalid displayName for " + p.Username)
		}
		if _, err := validateProfileSettings(p.Settings); err != nil {
			return errors.New("invalid settings for " + p.Username)
		}
		k := profileKey(p.Username)
		if _, dup := s.m[k]; dup {
			return errors.New("duplicate username " + p.Username)
		}
		s.m[k] = p
	}
	return nil
}

func (s *profileStore) Enabled() bool { return !s.disabled }

// save writes all profiles atomically. Callers hold s.mu.
func (s *profileStore) save() error {
	all := make([]Profile, 0, len(s.m))
	for _, p := range s.m {
		all = append(all, p)
	}
	sort.Slice(all, func(i, j int) bool { return profileKey(all[i].Username) < profileKey(all[j].Username) })
	b, err := json.Marshal(profilesDisk{Version: 1, Profiles: all})
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, "profiles-*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, s.path)
	}
	if err != nil {
		_ = os.Remove(tmp)
	}
	return err
}

func (s *profileStore) List() []profileSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]profileSummary, 0, len(s.m))
	for _, p := range s.m {
		out = append(out, profileSummary{p.Username, p.DisplayName})
	}
	sort.Slice(out, func(i, j int) bool { return profileKey(out[i].Username) < profileKey(out[j].Username) })
	return out
}

func (s *profileStore) Get(username string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.m[profileKey(username)]
	if !ok {
		return Profile{}, errNoProfile
	}
	return p, nil
}

// Create adds a profile. username, displayName and settings are already validated.
func (s *profileStore) Create(username, displayName string, settings json.RawMessage) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	if _, ok := s.m[k]; ok {
		return Profile{}, errProfileTaken
	}
	if len(s.m) >= maxProfiles {
		return Profile{}, errProfilesFull
	}
	p := Profile{Username: username, DisplayName: displayName, Settings: settings, UpdatedAt: s.now().UnixMilli()}
	s.m[k] = p
	if err := s.save(); err != nil {
		delete(s.m, k)
		return Profile{}, errProfilesSave
	}
	return p, nil
}

// Put replaces displayName and settings and returns the new updatedAt, which
// is strictly greater than the previous one.
func (s *profileStore) Put(username, displayName string, settings json.RawMessage) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	old, ok := s.m[k]
	if !ok {
		return 0, errNoProfile
	}
	at := s.now().UnixMilli()
	if at <= old.UpdatedAt {
		at = old.UpdatedAt + 1
	}
	s.m[k] = Profile{Username: old.Username, DisplayName: displayName, Settings: settings, UpdatedAt: at}
	if err := s.save(); err != nil {
		s.m[k] = old
		return 0, errProfilesSave
	}
	return at, nil
}

func (s *profileStore) Delete(username string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	old, ok := s.m[k]
	if !ok {
		return errNoProfile
	}
	delete(s.m, k)
	if err := s.save(); err != nil {
		s.m[k] = old
		return errProfilesSave
	}
	return nil
}

// HTTP handlers. They run inside commandLimit, so the token is already checked
// and rate limited.

func (a *api) profilesOn() error {
	if !a.p.Enabled() {
		return errProfilesOff
	}
	return nil
}

func (a *api) listProfiles(w http.ResponseWriter, _ *http.Request, _ string) error {
	if err := a.profilesOn(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"profiles": a.p.List()})
	return nil
}

func (a *api) getProfile(w http.ResponseWriter, r *http.Request, _ string) error {
	if err := a.profilesOn(); err != nil {
		return err
	}
	p, err := a.p.Get(r.PathValue("username"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, p)
	return nil
}

func (a *api) createProfile(w http.ResponseWriter, r *http.Request, _ string) error {
	if err := a.profilesOn(); err != nil {
		return err
	}
	var in struct {
		Username    string          `json:"username"`
		DisplayName *string         `json:"displayName"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	username, err := validateUsername(in.Username)
	if err != nil {
		return err
	}
	display := username
	if in.DisplayName != nil {
		if display, err = validateName(*in.DisplayName); err != nil {
			return err
		}
	}
	settings, err := validateProfileSettings(in.Settings)
	if err != nil {
		return err
	}
	p, err := a.p.Create(username, display, settings)
	if err != nil {
		return err
	}
	writeJSON(w, 201, p)
	return nil
}

func (a *api) putProfile(w http.ResponseWriter, r *http.Request, _ string) error {
	if err := a.profilesOn(); err != nil {
		return err
	}
	var in struct {
		DisplayName *string         `json:"displayName"`
		Settings    json.RawMessage `json:"settings"`
	}
	if err := decode(r, &in); err != nil {
		return err
	}
	if in.DisplayName == nil {
		return badRequest("displayName and settings are required")
	}
	display, err := validateName(*in.DisplayName)
	if err != nil {
		return err
	}
	settings, err := validateProfileSettings(in.Settings)
	if err != nil {
		return err
	}
	at, err := a.p.Put(r.PathValue("username"), display, settings)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int64{"updatedAt": at})
	return nil
}

func (a *api) deleteProfile(w http.ResponseWriter, r *http.Request, _ string) error {
	if err := a.profilesOn(); err != nil {
		return err
	}
	if err := a.p.Delete(r.PathValue("username")); err != nil {
		return err
	}
	writeJSON(w, 200, struct{}{})
	return nil
}
