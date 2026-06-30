package workspace

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateOrganizationRequiresName(t *testing.T) {
	service := NewService(nil)

	_, err := service.CreateOrganization(context.Background(), CreateOrganizationInput{
		OrganizationType: "lab",
		OwnerUserID:      uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestCreateOrganizationRejectsInvalidType(t *testing.T) {
	service := NewService(nil)

	_, err := service.CreateOrganization(context.Background(), CreateOrganizationInput{
		Name:             "Lab",
		OrganizationType: "school",
		OwnerUserID:      uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestValidOrganizationType(t *testing.T) {
	for _, value := range []string{"lab", "institution", "company", "government", "service_provider", "other"} {
		if !isValidOrganizationType(value) {
			t.Fatalf("expected valid organization type %q", value)
		}
	}
	if isValidOrganizationType("personal") {
		t.Fatal("personal should not be a valid organization type")
	}
}
