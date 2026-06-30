package site

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateRequiresSiteName(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		ProjectID:   uuid.New(),
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestValidateCoordinates(t *testing.T) {
	lat := 91.0
	if apperr.KindOf(validateCoordinates(&lat, nil)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid latitude to be rejected")
	}

	lon := 181.0
	if apperr.KindOf(validateCoordinates(nil, &lon)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid longitude to be rejected")
	}
}

func TestSiteStatusValidation(t *testing.T) {
	for _, status := range []string{"active", "archived"} {
		if !isValidSiteStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if isValidSiteStatus("disabled") {
		t.Fatal("disabled should not be a valid site status")
	}
}
