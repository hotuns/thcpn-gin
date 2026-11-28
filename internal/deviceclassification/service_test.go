package deviceclassification

import (
	"reflect"
	"strings"
	"testing"
)

func TestDeviceMapUsesExplicitInstallationLocation(t *testing.T) {
	// Profiles contain explicit installation coordinates, never cached source
	// runtime positions. Children do not silently inherit a parent's override.
	for _, removed := range []string{"parent_dp", "device_runtime"} {
		if strings.Contains(deviceMapQuery, removed) {
			t.Fatalf("device map query references removed source-owned storage %q", removed)
		}
	}
	if !strings.Contains(deviceMapQuery, "THEN dp.latitude") || !strings.Contains(deviceMapQuery, "THEN 'device'") {
		t.Fatal("manual installation coordinates must take precedence over site coordinates")
	}
}

func TestNormalizeFieldsRejectsUnknownAndSorts(t *testing.T) {
	got, err := normalizeFields([]string{"ecosystem", "ecosystem"})
	if err != nil {
		t.Fatalf("normalize fields: %v", err)
	}
	want := []string{"ecosystem"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	if _, err := normalizeFields([]string{"purposes"}); err == nil {
		t.Fatal("expected removed legacy field to fail")
	}
	if _, err := normalizeFields([]string{"unknown"}); err == nil {
		t.Fatal("expected unknown field to fail")
	}
}
