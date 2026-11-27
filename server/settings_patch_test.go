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
