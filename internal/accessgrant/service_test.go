package accessgrant

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateGrantRequiresExactlyOneSubjectSelector(t *testing.T) {
	service := NewService(nil)

	_, err := service.CreateGrant(context.Background(), CreateGrantInput{
		RoleCode:    "shared_viewer",
		ScopeType:   "project",
		ScopeID:     uuid.New(),
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing selector, got %v", err)
	}

	_, err = service.CreateGrant(context.Background(), CreateGrantInput{
		SubjectUserID: uuid.New(),
		Email:         "expert@example.com",
		RoleCode:      "shared_viewer",
		ScopeType:     "project",
		ScopeID:       uuid.New(),
		ActorUserID:   uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for multiple selectors, got %v", err)
	}
}

func TestAccessGrantRoleValidation(t *testing.T) {
	for _, role := range []string{"project_manager", "site_operator", "data_manager", "researcher", "viewer", "shared_viewer", "shared_downloader", "service_engineer"} {
		if !isAccessGrantRole(role) {
			t.Fatalf("expected %q to be valid access grant role", role)
		}
	}
	for _, role := range []string{"owner", "admin", "unknown"} {
		if isAccessGrantRole(role) {
			t.Fatalf("expected %q to be rejected for access grant", role)
		}
	}
}

func TestServiceEngineerGrantRequiresExpiry(t *testing.T) {
	service := NewService(nil)

	_, err := service.resolveRole(context.Background(), serviceEngineerRoleCode, "device", nil)
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected service engineer grant without expiry to be rejected, got %v", err)
	}
}

func TestValidateExpiresAt(t *testing.T) {
	past := time.Now().Add(-time.Minute)
	if apperr.KindOf(validateExpiresAt(&past)) != apperr.KindInvalidArgument {
		t.Fatal("expected past expires_at to be rejected")
	}

	future := time.Now().Add(time.Hour)
	if err := validateExpiresAt(&future); err != nil {
		t.Fatalf("expected future expires_at to be accepted: %v", err)
	}
}

func TestMatchesInvitee(t *testing.T) {
	inviteeEmail := "expert@example.com"
	actorEmail := "EXPERT@example.com"
	if !matchesInvitee(&inviteeEmail, nil, &actorEmail, nil) {
		t.Fatal("expected email match to be case-insensitive")
	}

	inviteePhone := "13800000000"
	actorPhone := "13800000000"
	if !matchesInvitee(nil, &inviteePhone, nil, &actorPhone) {
		t.Fatal("expected phone match")
	}
}
