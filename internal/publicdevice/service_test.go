package publicdevice

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestPublicWindowIsExactly72Hours(t *testing.T) {
	end := time.Date(2026, 7, 18, 12, 30, 0, 0, time.UTC)
	start, actualEnd := Window(end)
	if actualEnd != end || end.Sub(start) != 72*time.Hour {
		t.Fatalf("unexpected public window: %v - %v", start, actualEnd)
	}
}

func TestSessionIsScopedToSlugAndAccessVersion(t *testing.T) {
	manager := newSessionManager("test-secret")
	publication := Publication{DeviceID: uuid.New(), PublicSlug: "fixed-public-device-slug", AccessVersion: 3}
	token, _, err := manager.create(publication)
	if err != nil {
		t.Fatal(err)
	}
	if !manager.valid(token, publication) {
		t.Fatal("expected session to be valid")
	}
	publication.AccessVersion++
	if manager.valid(token, publication) {
		t.Fatal("version change must revoke the session")
	}
	publication.AccessVersion--
	publication.PublicSlug = "another-fixed-public-slug"
	if manager.valid(token, publication) {
		t.Fatal("session must not unlock another device")
	}
}

func TestGeneratedSlugsAreOpaqueAndUnique(t *testing.T) {
	first, err := newSlug()
	if err != nil {
		t.Fatal(err)
	}
	second, err := newSlug()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) < 20 || first == second {
		t.Fatalf("unexpected slugs %q %q", first, second)
	}
}
