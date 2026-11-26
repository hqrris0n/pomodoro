package main

import (
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Accounts: each profile record also carries a password hash and at most one
// session. The rule that keeps the store responsive is that PBKDF2 never runs
// while s.mu is held: every method that hashes takes a snapshot under the
// lock, unlocks, hashes (under the semaphore, see s.pbkdf2), then locks again
// and applies its change only if the snapshot is still current
// (compare-and-swap). The only callers of s.pbkdf2 are hashPassword and
// verifyPassword, and neither is ever called with s.mu held.

const (
	defaultPBKDF2Iter   = 600_000
	maxPBKDF2Iter       = 10_000_000
	pbkdf2SaltBytes     = 16
	pbkdf2KeyBytes      = 32
	pbkdf2Prefix        = "pbkdf2-sha256"
	maxConcurrentHashes = 2

	minPasswordLen = 8
	maxPasswordLen = 72
	// migratedPassword is given to every profile carried over from a
	// version-1 file.
	migratedPassword = "12345678"

	sessionTokenBytes = 32
	sessionTTL        = 30 * 24 * time.Hour
	// sessionRenewSlack: a session is renewed to now+sessionTTL whenever it
	// is used, but writing the file on every request would be wasteful, so
	// Lookup only renews (in memory and on disk together) once the stored
	// expiry is more than this much behind now+sessionTTL. A session
	// therefore always has at least sessionTTL-sessionRenewSlack left after a
	// use, and memory never differs from the file.
	sessionRenewSlack = 24 * time.Hour
)

var (
	errBadLogin      = &apiError{401, "Wrong username or password."}
	errWrongPassword = &apiError{401, "Wrong password."}
	errNoSession     = &apiError{401, "Not signed in."}
	errPasswordShort = badRequest("Password must be at least 8 characters.")
	errPasswordLong  = badRequest("Password must be at most 72 characters.")
	errHashFailed    = &apiError{500, "could not hash password"}
)

// account is the stored form of one record: the public Profile plus auth.
type account struct {
	Profile
	PasswordHash string `json:"passwordHash"` // pbkdf2-sha256$<iter>$<salt b64>$<hash b64>
	// SessionHash is hex SHA-256 of the current session token; "" = none.
	SessionHash    string `json:"sessionHash"`
	SessionExpires int64  `json:"sessionExpires"` // unix ms; 0 when no session
	// SessionGen increases by one for every new session of this account.
	SessionGen uint64 `json:"sessionGen"`
}

// sessionGrant is what a new session returns. Token is the only copy of the
// plain token; the store keeps just its hash.
type sessionGrant struct {
	Token   string
	Gen     uint64
	Profile Profile
}

func validatePassword(p string) error {
	n := utf8.RuneCountInString(p)
	if n < minPasswordLen {
		return errPasswordShort
	}
	if n > maxPasswordLen {
		return errPasswordLong
	}
	return nil
}

// pbkdf2 is the only place PBKDF2 runs. At most maxConcurrentHashes run at
// once across the store.
func (s *profileStore) pbkdf2(password string, salt []byte, iter, n int) ([]byte, error) {
	s.sem <- struct{}{}
	defer func() { <-s.sem }()
	return pbkdf2.Key(sha256.New, password, salt, iter, n)
}

// hashPassword returns a new hash string with a random salt. Never call it
// with s.mu held.
func (s *profileStore) hashPassword(password string) (string, error) {
	salt := make([]byte, pbkdf2SaltBytes)
	_, _ = rand.Read(salt) // crypto/rand.Read never fails (it crashes instead)
	key, err := s.pbkdf2(password, salt, s.iter, pbkdf2KeyBytes)
	if err != nil {
		return "", err
	}
	return formatPasswordHash(s.iter, salt, key), nil
}

// verifyPassword reports whether password matches stored, using the
// iteration count recorded in stored. Never call it with s.mu held.
func (s *profileStore) verifyPassword(stored, password string) bool {
	iter, salt, want, err := parsePasswordHash(stored)
	if err != nil {
		return false
	}
	got, err := s.pbkdf2(password, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

var b64 = base64.RawStdEncoding

func formatPasswordHash(iter int, salt, key []byte) string {
	return pbkdf2Prefix + "$" + strconv.Itoa(iter) + "$" + b64.EncodeToString(salt) + "$" + b64.EncodeToString(key)
}

func parsePasswordHash(h string) (iter int, salt, key []byte, err error) {
	parts := strings.Split(h, "$")
	if len(parts) != 4 || parts[0] != pbkdf2Prefix {
		return 0, nil, nil, errors.New("bad password hash format")
	}
	iter, err = strconv.Atoi(parts[1])
	if err != nil || iter < 1 || iter > maxPBKDF2Iter || parts[1] != strconv.Itoa(iter) {
		return 0, nil, nil, errors.New("bad password hash iterations")
	}
	if salt, err = b64.DecodeString(parts[2]); err != nil || len(salt) == 0 {
		return 0, nil, nil, errors.New("bad password hash salt")
	}
	if key, err = b64.DecodeString(parts[3]); err != nil || len(key) != pbkdf2KeyBytes {
		return 0, nil, nil, errors.New("bad password hash key")
	}
	return iter, salt, key, nil
}

func sessionHashOf(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func validSessionHash(h string) bool {
	if len(h) != 2*sha256.Size {
		return false
	}
	_, err := hex.DecodeString(h)
	return err == nil && strings.ToLower(h) == h
}

// startSessionLocked gives a a fresh session and returns its plain token.
// Callers hold s.mu.
func (s *profileStore) startSessionLocked(a *account) string {
	b := make([]byte, sessionTokenBytes)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	a.SessionHash = sessionHashOf(token)
	a.SessionExpires = s.now().Add(sessionTTL).UnixMilli()
	a.SessionGen++
	return token
}

// setLocked stores a under k and keeps the session index in step. Callers
// hold s.mu.
func (s *profileStore) setLocked(k string, a account) {
	if old, ok := s.m[k]; ok && old.SessionHash != "" {
		delete(s.bySession, old.SessionHash)
	}
	s.m[k] = a
	if a.SessionHash != "" {
		s.bySession[a.SessionHash] = k
	}
}

// deleteLocked removes k and its session. Callers hold s.mu.
func (s *profileStore) deleteLocked(k string) {
	if old, ok := s.m[k]; ok && old.SessionHash != "" {
		delete(s.bySession, old.SessionHash)
	}
	delete(s.m, k)
}

// sessionLocked finds the live session for token. Callers hold s.mu.
func (s *profileStore) sessionLocked(token string) (string, account, error) {
	if token == "" {
		return "", account{}, errNoSession
	}
	k, ok := s.bySession[sessionHashOf(token)]
	if !ok {
		return "", account{}, errNoSession
	}
	a := s.m[k]
	if a.SessionExpires <= s.now().UnixMilli() {
		return "", account{}, errNoSession
	}
	return k, a, nil
}

// hook is the test hook, called with s.mu held between a check and the
// change it guards. op is "signup", "login", "change-password" or "delete".
func (s *profileStore) hook(op string) {
	if s.testHook != nil {
		s.testHook(op)
	}
}

// SignUp creates an account with a fresh session. displayName and settings
// are already validated; username and password are validated here.
func (s *profileStore) SignUp(username, displayName string, settings json.RawMessage, password string) (sessionGrant, error) {
	if s.disabled {
		return sessionGrant{}, errProfilesOff
	}
	username, err := validateUsername(username)
	if err != nil {
		return sessionGrant{}, err
	}
	if err := validatePassword(password); err != nil {
		return sessionGrant{}, err
	}
	ph, err := s.hashPassword(password) // outside s.mu
	if err != nil {
		return sessionGrant{}, errHashFailed
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	k := profileKey(username)
	if _, ok := s.m[k]; ok {
		return sessionGrant{}, errProfileTaken
	}
	if len(s.m) >= maxProfiles {
		return sessionGrant{}, errProfilesFull
	}
	s.hook("signup")
	a := account{
		Profile:      Profile{Username: username, DisplayName: displayName, Settings: settings, UpdatedAt: s.now().UnixMilli()},
		PasswordHash: ph,
	}
	token := s.startSessionLocked(&a)
	s.setLocked(k, a)
	if err := s.save(); err != nil {
		s.deleteLocked(k)
		return sessionGrant{}, errProfilesSave
	}
	return sessionGrant{Token: token, Gen: a.SessionGen, Profile: a.Profile}, nil
}

// Login checks the password and replaces the account's session. Unknown
// usernames are checked against a dummy hash so they take as long as a wrong
// password. If the password hash changed while it was being verified, the
// login fails.
func (s *profileStore) Login(username, password string) (sessionGrant, error) {
	if s.disabled {
		return sessionGrant{}, errProfilesOff
	}
	k := profileKey(username)
	s.mu.Lock()
	snap, known := s.m[k]
	s.mu.Unlock()

	stored := s.dummyHash
	if known {
		stored = snap.PasswordHash
	}
	if ok := s.verifyPassword(stored, password); !ok || !known { // outside s.mu
		return sessionGrant{}, errBadLogin
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.m[k]
	if !ok || cur.PasswordHash != snap.PasswordHash {
		return sessionGrant{}, errBadLogin
	}
	s.hook("login")
	old := cur
	token := s.startSessionLocked(&cur)
	s.setLocked(k, cur)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
		return sessionGrant{}, errProfilesSave
	}
	return sessionGrant{Token: token, Gen: cur.SessionGen, Profile: cur.Profile}, nil
}

// Lookup returns the account and session generation for a live token and
// renews the session (see sessionRenewSlack).
func (s *profileStore) Lookup(token string) (Profile, uint64, error) {
	if s.disabled {
		return Profile{}, 0, errProfilesOff
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	k, a, err := s.sessionLocked(token)
	if err != nil {
		return Profile{}, 0, err
	}
	exp := s.now().Add(sessionTTL).UnixMilli()
	if exp-a.SessionExpires > sessionRenewSlack.Milliseconds() {
		old := a
		a.SessionExpires = exp
		s.setLocked(k, a)
		if s.save() != nil {
			// The session is still valid until its old expiry; a failed
			// renewal should not fail the request.
			s.setLocked(k, old)
			a = old
		}
	}
	return a.Profile, a.SessionGen, nil
}

// Logout ends the session for token. An unknown or expired token is not an
// error.
func (s *profileStore) Logout(token string) error {
	if s.disabled {
		return errProfilesOff
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	k, ok := s.bySession[sessionHashOf(token)]
	if !ok || token == "" {
		return nil
	}
	old := s.m[k]
	a := old
	a.SessionHash, a.SessionExpires = "", 0
	s.setLocked(k, a)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
		return errProfilesSave
	}
	return nil
}

// Put replaces displayName and settings of the session's account (both
// already validated), renews the session, and returns the new updatedAt.
func (s *profileStore) Put(token, displayName string, settings json.RawMessage) (int64, error) {
	if s.disabled {
		return 0, errProfilesOff
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	k, old, err := s.sessionLocked(token)
	if err != nil {
		return 0, err
	}
	a := updatedLocked(old, displayName, settings, s.now())
	a.SessionExpires = s.now().Add(sessionTTL).UnixMilli()
	s.setLocked(k, a)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
		return 0, errProfilesSave
	}
	return a.UpdatedAt, nil
}

// Delete removes the session's account after checking its password. It fails
// with errNoSession if the session was replaced while the password was being
// checked.
func (s *profileStore) Delete(token, password string) error {
	if s.disabled {
		return errProfilesOff
	}
	s.mu.Lock()
	k, snap, err := s.sessionLocked(token)
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if !s.verifyPassword(snap.PasswordHash, password) { // outside s.mu
		return errWrongPassword
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.m[k]
	if !ok || cur.SessionHash != snap.SessionHash {
		return errNoSession
	}
	s.hook("delete")
	s.deleteLocked(k)
	if err := s.save(); err != nil {
		s.setLocked(k, cur)
		return errProfilesSave
	}
	return nil
}

// ChangePassword checks current, sets next and rotates the session in one
// compare-and-swap: it applies only if the session and password hash are
// both unchanged since the check. It returns the new session.
func (s *profileStore) ChangePassword(token, current, next string) (sessionGrant, error) {
	if s.disabled {
		return sessionGrant{}, errProfilesOff
	}
	s.mu.Lock()
	k, snap, err := s.sessionLocked(token)
	s.mu.Unlock()
	if err != nil {
		return sessionGrant{}, err
	}
	if err := validatePassword(next); err != nil {
		return sessionGrant{}, err
	}
	if !s.verifyPassword(snap.PasswordHash, current) { // outside s.mu
		return sessionGrant{}, errWrongPassword
	}
	ph, err := s.hashPassword(next) // outside s.mu
	if err != nil {
		return sessionGrant{}, errHashFailed
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	cur, ok := s.m[k]
	if !ok || cur.SessionHash != snap.SessionHash || cur.PasswordHash != snap.PasswordHash {
		return sessionGrant{}, errNoSession
	}
	s.hook("change-password")
	old := cur
	cur.PasswordHash = ph
	token = s.startSessionLocked(&cur)
	s.setLocked(k, cur)
	if err := s.save(); err != nil {
		s.setLocked(k, old)
		return sessionGrant{}, errProfilesSave
	}
	return sessionGrant{Token: token, Gen: cur.SessionGen, Profile: cur.Profile}, nil
}

// updatedLocked returns old with new displayName and settings and an
// updatedAt strictly greater than before.
func updatedLocked(old account, displayName string, settings json.RawMessage, now time.Time) account {
	at := now.UnixMilli()
	if at <= old.UpdatedAt {
		at = old.UpdatedAt + 1
	}
	a := old
	a.DisplayName, a.Settings, a.UpdatedAt = displayName, settings, at
	return a
}
