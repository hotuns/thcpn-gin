package device

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateRequiresSerialNo(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		Name:        "Station 1",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestCreateRequiresProjectWhenSiteSet(t *testing.T) {
	service := NewService(nil)
	siteID := uuid.New()

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		SiteID:      &siteID,
		SerialNo:    "SN001",
		Name:        "Station 1",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestCapabilityValidation(t *testing.T) {
	capabilities, err := normalizeCapabilities([]string{"telemetry", "telemetry", "image_capture", ""})
	if err != nil {
		t.Fatalf("expected capabilities to be valid: %v", err)
	}
	if len(capabilities) != 2 {
		t.Fatalf("expected duplicate capabilities to be removed, got %v", capabilities)
	}

	_, err = normalizeCapabilities([]string{"raw_sql"})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid capability to be rejected, got %v", err)
	}
}

func TestDeviceStatusValidation(t *testing.T) {
	for _, status := range []string{"active", "disabled", "retired"} {
		if !isValidDeviceStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if isValidDeviceStatus("archived") {
		t.Fatal("archived should not be a valid device status")
	}
}
