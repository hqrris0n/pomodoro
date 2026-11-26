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
	maxProfiles      = 50
	maxSettingsBytes = 256 << 10
	// profileBodyBytes leaves room for the envelope around maximal settings.
	profileBodyBytes = maxSettingsBytes + 4<<10
	profilesFile     = "profiles.json"
	// profilesVersion is the file version written. Version 1 (profiles
	// without passwords) is migrated on load.
	profilesVersion = 2
)

var (
	errNoProfile      = &apiError{404, "no such profile"}
	errProfileTaken   = &apiError{409, "That username is taken."}
	errProfilesFull   = &apiError{429, "Too many accounts"}
	errProfilesOff    = &apiError{503, "profiles are unavailable"}
	errProfilesSave   = &apiError{500, "could not save profiles"}
	errSettingsObject = badRequest("settings must be a JSON object")
)

// Profile is the public part of one account: the wire form of its saved
// settings.
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
	Profiles []account `json:"profiles"`
}

// profileStore keeps all accounts in memory and in <dir>/profiles.json. If the
// file cannot be read or is corrupt the store is disabled and never writes, so
// the file stays exactly as found.
type profileStore struct {
	mu        sync.Mutex
	path      string
	dir       string
	now       func() time.Time
	disabled  bool
	m         map[string]account // keyed by lowercased username
	bySession map[string]string  // session hash -> key in m

	iter      int           // PBKDF2 iterations for new hashes
	sem       chan struct{} // bounds concurrent PBKDF2 runs
	dummyHash string        // checked for unknown usernames
	// testHook, if set, is called with s.mu held between a check and the
	// change it guards (see hook). Always nil in production.
	testHook func(op string)
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
	return openProfilesIter(dir, now, logf, defaultPBKDF2Iter)
}

// openProfilesIter is openProfiles with a PBKDF2 iteration count for new
// hashes (tests use a low one).
func openProfilesIter(dir string, now func() time.Time, logf func(format string, args ...any), iter int) *profileStore {
	s := &profileStore{
		dir: dir, path: filepath.Join(dir, profilesFile), now: now,
		m: map[string]account{}, bySession: map[string]string{},
		iter: iter, sem: make(chan struct{}, maxConcurrentHashes),
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logf("profiles disabled: %v", err)
		s.disabled = true
		return s
	}
	raw, err := os.ReadFile(s.path)
	if err == nil {
		err = s.parse(raw)
	} else if errors.Is(err, os.ErrNotExist) {
		err = nil
	}
	if err == nil {
		// Hashed with a random password nobody knows.
		if s.dummyHash, err = s.hashPassword(sessionHashOf(s.path + s.now().String())); err != nil {
			err = errors.New("cannot hash: " + err.Error())
		}
	}
	if err != nil {
		logf("profiles disabled: %s: %v", s.path, err)
		s.disabled = true
		s.m, s.bySession = map[string]account{}, map[string]string{}
	}
	return s
}

func strictDecode(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if _, err := dec.Token(); err != io.EOF {
		return errors.New("unexpected data after JSON")
	}
	return nil
}

// parse loads a version 1 or 2 file. Version 1 records get the password
// migratedPassword and no session; the file itself is not rewritten here but
// on the next change, which always writes version 2. It runs before the store
// is shared, so the hashing here is not under s.mu.
func (s *profileStore) parse(raw []byte) error {
	var head struct {
		Version  int             `json:"version"`
		Profiles json.RawMessage `json:"profiles"`
	}
	if err := strictDecode(raw, &head); err != nil {
		return err
	}
	if t := bytes.TrimSpace(head.Profiles); len(t) == 0 || string(t) == "null" {
		return errors.New("missing profiles")
	}
	var all []account
	switch head.Version {
	case 1:
		var ps []Profile
		if err := strictDecode(head.Profiles, &ps); err != nil {
			return err
		}
		for _, p := range ps {
			all = append(all, account{Profile: p})
		}
	case profilesVersion:
		if err := strictDecode(head.Profiles, &all); err != nil {
			return err
		}
	default:
		return errors.New("unsupported or missing version")
	}
	for _, a := range all {
		u, err := validateUsername(a.Username)
		if err != nil || u != a.Username {
			return errors.New("invalid username " + a.Username)
		}
		if _, err := validateName(a.DisplayName); err != nil {
			return errors.New("invalid displayName for " + a.Username)
		}
		if _, err := validateProfileSettings(a.Settings); err != nil {
			return errors.New("invalid settings for " + a.Username)
		}
		k := profileKey(a.Username)
		if _, dup := s.m[k]; dup {
			return errors.New("duplicate username " + a.Username)
		}
		if head.Version == 1 {
			if a.PasswordHash, err = s.hashPassword(migratedPassword); err != nil {
				return errors.New("cannot hash: " + err.Error())
			}
		} else {
			if _, _, _, err := parsePasswordHash(a.PasswordHash); err != nil {
				return errors.New("invalid passwordHash for " + a.Username)
			}
			if a.SessionHash != "" {
				if !validSessionHash(a.SessionHash) || a.SessionExpires <= 0 {
					return errors.New("invalid session for " + a.Username)
				}
				if _, dup := s.bySession[a.SessionHash]; dup {
					return errors.New("duplicate session for " + a.Username)
				}
			} else if a.SessionExpires != 0 {
				return errors.New("invalid session for " + a.Username)
			}
		}
		s.setLocked(k, a)
	}
	return nil
}

func (s *profileStore) Enabled() bool { return !s.disabled }

// save writes all accounts atomically. Callers hold s.mu.
func (s *profileStore) save() error {
	all := make([]account, 0, len(s.m))
	for _, a := range s.m {
		all = append(all, a)
	}
	sort.Slice(all, func(i, j int) bool { return profileKey(all[i].Username) < profileKey(all[j].Username) })
	b, err := json.Marshal(profilesDisk{Version: profilesVersion, Profiles: all})
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
	for _, a := range s.m {
		out = append(out, profileSummary{a.Username, a.DisplayName})
	}
	sort.Slice(out, func(i, j int) bool { return profileKey(out[i].Username) < profileKey(out[j].Username) })
	return out
}

func (s *profileStore) Get(username string) (Profile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	a, ok := s.m[profileKey(username)]
	if !ok {
		return Profile{}, errNoProfile
	}
	return a.Profile, nil
}

// putByName and deleteByName serve only the pre-account HTTP handlers below,
// which have no sessions; they go away when those handlers are replaced.
func (s *profileStore) putByName(username, displayName string, settings json.RawMessage) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	old, ok := s.m[k]
	if !ok {
		return 0, errNoProfile
	}
	a := updatedLocked(old, displayName, settings, s.now())
	s.setLocked(k, a)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
		return 0, errProfilesSave
	}
	return a.UpdatedAt, nil
}

func (s *profileStore) deleteByName(username string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	old, ok := s.m[k]
	if !ok {
		return errNoProfile
	}
	s.deleteLocked(k)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
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
	// This pre-account endpoint takes no password, so it uses the migration
	// default until the handler is replaced.
	g, err := a.p.SignUp(username, display, settings, migratedPassword)
	if err != nil {
		return err
	}
	writeJSON(w, 201, g.Profile)
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
	at, err := a.p.putByName(r.PathValue("username"), display, settings)
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
	if err := a.p.deleteByName(r.PathValue("username")); err != nil {
		return err
	}
	writeJSON(w, 200, struct{}{})
	return nil
}
