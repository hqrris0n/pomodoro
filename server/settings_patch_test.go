package main

import (
	"fmt"
	"strings"
	"testing"
)

// patchOf turns a full Settings into a patch that sets every field it has
// (a nil Mix or Mixes stays absent).
func patchOf(s Settings) *settingsPatch {
	return &settingsPatch{DrinkID: &s.DrinkID, BackgroundID: &s.BackgroundID,
		BackgroundRotateMin: &s.BackgroundRotateMin, Mix: s.Mix, Mixes: s.Mixes}
}

func TestPatchSettingsMerge(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada") // latte, window, mix {rain: 0.5}
	str := func(s string) *string { return &s }
	patch := func(p settingsPatch) (Room, error) {
		v, err := validatePatch(p)
		if err != nil {
			return Room{}, err
		}
		return h.Patch(tok(1), r.ID, &v, nil, false)
	}
	// One channel changes; everything else is untouched.
	got, err := patch(settingsPatch{Mix: map[string]float64{"fire": 0.3}})
	if err != nil || got.Settings.Mix["rain"] != 0.5 || got.Settings.Mix["fire"] != 0.3 ||
		got.Settings.DrinkID != "latte" || got.Settings.BackgroundID != "window" {
		t.Fatalf("add channel: %v %+v", err, got.Settings)
	}
	got, err = patch(settingsPatch{Mix: map[string]float64{"rain": 0.4}})
	if err != nil || got.Settings.Mix["rain"] != 0.4 || got.Settings.Mix["fire"] != 0.3 || len(got.Settings.Mix) != 2 {
		t.Fatalf("move rain: %v %+v", err, got.Settings.Mix)
	}
	// Level 0 removes the channel.
	got, err = patch(settingsPatch{Mix: map[string]float64{"rain": 0}})
	if _, has := got.Settings.Mix["rain"]; err != nil || has || got.Settings.Mix["fire"] != 0.3 {
		t.Fatalf("remove: %v %+v", err, got.Settings.Mix)
	}
	// Only the background changes.
	got, err = patch(settingsPatch{BackgroundID: str("x")})
	if err != nil || got.Settings.BackgroundID != "x" || got.Settings.DrinkID != "latte" || got.Settings.Mix["fire"] != 0.3 {
		t.Fatalf("background: %v %+v", err, got.Settings)
	}
	// A merge past 16 channels is 400 and changes nothing, not even the
	// background sent alongside it.
	big := map[string]float64{}
	for i := range 16 {
		big[fmt.Sprint("c", i)] = 0.1
	}
	_, err = patch(settingsPatch{BackgroundID: str("y"), Mix: big})
	wantStatus(t, err, 400)
	cur, _ := h.room(r.ID)
	if len(cur.Settings.Mix) != 1 || cur.Settings.Mix["fire"] != 0.3 || cur.Settings.BackgroundID != "x" {
		t.Fatalf("rejected merge changed the room: %+v", cur.Settings)
	}
	// Invalid values are still 400.
	rot := 500
	for name, p := range map[string]settingsPatch{
		"volume":   {Mix: map[string]float64{"a": 2}},
		"long id":  {Mix: map[string]float64{strings.Repeat("a", 33): 0.1}},
		"rotation": {BackgroundRotateMin: &rot},
	} {
		if _, err := patch(p); err == nil {
			t.Fatalf("%s accepted", name)
		} else {
			wantStatus(t, err, 400)
		}
	}
}

func TestPatchSettingsKeepsMixes(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	v, _ := validatePatch(settingsPatch{Mixes: []SavedMix{mixOf("a", "A", 0.5)}})
	if _, err := h.Patch(tok(1), r.ID, &v, nil, false); err != nil {
		t.Fatal(err)
	}
	v, _ = validatePatch(settingsPatch{Mix: map[string]float64{"rain": 0.1}})
	got, err := h.Patch(tok(1), r.ID, &v, nil, false)
	if err != nil || len(got.Settings.Mixes) != 1 || got.Settings.Mix["rain"] != 0.1 {
		t.Fatalf("%v %+v", err, got.Settings)
	}
}

func appendPatch(t *testing.T, ms ...SavedMix) *settingsPatch {
	t.Helper()
	v, err := validatePatch(settingsPatch{AppendMixes: ms})
	if err != nil {
		t.Fatal(err)
	}
	return &v
}

func mixIDs(r Room) string {
	var ids []string
	for _, m := range r.Settings.Mixes {
		ids = append(ids, m.ID)
	}
	return strings.Join(ids, ",")
}

func TestPatchAppendMixes(t *testing.T) {
	h, _ := newTestHub()
	r := mustCreate(t, h, tok(1), "Ada")
	mustJoin(t, h, tok(2), r.ID, "Bo")
	mustJoin(t, h, tok(3), r.ID, "Cy")
	if _, err := h.SetRole(tok(1), r.ID, memberID(tok(2)), roleCohost); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Patch(tok(1), r.ID, &settingsPatch{Mixes: []SavedMix{mixOf("a", "A", 0.1)}}, nil, false); err != nil {
		t.Fatal(err)
	}

	// Co-host and host append at the end.
	got, err := h.Patch(tok(2), r.ID, appendPatch(t, mixOf("b", "B", 0.2)), nil, false)
	if err != nil || mixIDs(got) != "a,b" {
		t.Fatalf("cohost: %v %s", err, mixIDs(got))
	}
	got, err = h.Patch(tok(1), r.ID, appendPatch(t, mixOf("c", "C", 0.3), mixOf("d", "D", 0.4)), nil, false)
	if err != nil || mixIDs(got) != "a,b,c,d" {
		t.Fatalf("host: %v %s", err, mixIDs(got))
	}

	// A retry adds nothing and succeeds.
	got, err = h.Patch(tok(2), r.ID, appendPatch(t, mixOf("b", "B", 0.2)), nil, false)
	if err != nil || mixIDs(got) != "a,b,c,d" {
		t.Fatalf("retry: %v %s", err, mixIDs(got))
	}

	// Same id with another name or mix is 400 and nothing changes, even when
	// an earlier entry in the same request would have been added.
	for _, bad := range []SavedMix{mixOf("b", "Other", 0.2), mixOf("b", "B", 0.9)} {
		_, err = h.Patch(tok(2), r.ID, appendPatch(t, mixOf("e", "E", 0.5), bad), nil, false)
		wantStatus(t, err, 400)
	}
	if cur, _ := h.room(r.ID); mixIDs(cur) != "a,b,c,d" {
		t.Fatalf("changed after 400: %s", mixIDs(cur))
	}

	// Guests are refused.
	_, err = h.Patch(tok(3), r.ID, appendPatch(t, mixOf("z", "Z", 0.1)), nil, false)
	wantStatus(t, err, 403)

	// Over 40 entries is 400 and nothing changes.
	var many []SavedMix
	for i := range 36 {
		many = append(many, mixOf(fmt.Sprintf("m%d", i), "M", 0.1))
	}
	if _, err = h.Patch(tok(1), r.ID, appendPatch(t, many...), nil, false); err != nil {
		t.Fatal(err)
	}
	_, err = h.Patch(tok(2), r.ID, appendPatch(t, mixOf("over", "Over", 0.1)), nil, false)
	wantStatus(t, err, 400)
	if cur, _ := h.room(r.ID); len(cur.Settings.Mixes) != 40 {
		t.Fatalf("len %d", len(cur.Settings.Mixes))
	}
}

func TestValidateAppendMixes(t *testing.T) {
	ok := mixOf("a", "A", 0.1)
	long := strings.Repeat("x", 41)
	var fortyOne []SavedMix
	for i := range 41 {
		fortyOne = append(fortyOne, mixOf(fmt.Sprint(i), "M", 0.1))
	}
	bad := map[string]settingsPatch{
		"both":       {Mixes: []SavedMix{ok}, AppendMixes: []SavedMix{mixOf("b", "B", 0.1)}},
		"empty":      {AppendMixes: []SavedMix{}},
		"too many":   {AppendMixes: fortyOne},
		"empty id":   {AppendMixes: []SavedMix{mixOf("", "A", 0.1)}},
		"long id":    {AppendMixes: []SavedMix{mixOf(long, "A", 0.1)}},
		"empty name": {AppendMixes: []SavedMix{mixOf("a", "", 0.1)}},
		"long name":  {AppendMixes: []SavedMix{mixOf("a", strings.Repeat("n", 31), 0.1)}},
		"bad mix":    {AppendMixes: []SavedMix{{ID: "a", Name: "A", Mix: map[string]float64{"rain": 2}}}},
	}
	for name, p := range bad {
		_, err := validatePatch(p)
		if err == nil {
			t.Errorf("%s: want 400", name)
			continue
		}
		wantStatus(t, err, 400)
	}
}
