package deviceclassification

import (
	"reflect"
	"strings"
	"testing"
)

func TestDeviceMapQueryDoesNotUseRemovedRuntimeColumns(t *testing.T) {
	for _, removed := range []string{"device_profiles", "dp.latitude", "dp.longitude", "parent_dp"} {
		if strings.Contains(deviceMapQuery, removed) {
			t.Fatalf("device map query references removed source-owned storage %q", removed)
		}
	}
}

func TestNormalizeFieldsRejectsUnknownAndSorts(t *testing.T) {
	got, err := normalizeFields([]string{"purposes", "ecosystem", "purposes"})
	if err != nil {
		t.Fatalf("normalize fields: %v", err)
	}
	want := []string{"ecosystem", "purposes"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if _, err := normalizeFields([]string{"unknown"}); err == nil {
		t.Fatal("expected unknown field to fail")
	}
}

func TestApplyFieldUsesWholeCollectionOverride(t *testing.T) {
	inherited := Values{ResearchTags: []string{"site"}, Purposes: []Term{{Code: "site"}}, ObservationObjects: []Term{}}
	direct := Values{ResearchTags: []string{}, Purposes: []Term{{Code: "device"}}, ObservationObjects: []Term{}}
	applyField(&inherited, direct, "purposes")
	applyField(&inherited, direct, "research_tags")
	if len(inherited.Purposes) != 1 || inherited.Purposes[0].Code != "device" {
		t.Fatalf("purposes were not replaced: %#v", inherited.Purposes)
	}
	if len(inherited.ResearchTags) != 0 {
		t.Fatalf("empty override must clear inherited tags: %#v", inherited.ResearchTags)
	}
}

func TestCleanTagsTrimsDeduplicatesAndSorts(t *testing.T) {
	got := cleanTags([]string{" beta ", "alpha", "", "alpha"})
	want := []string{"alpha", "beta"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}
