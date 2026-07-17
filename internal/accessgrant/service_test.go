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
		TemplateCode:    "shared_viewer",
		PermissionCodes: []string{"project.view"},
		ScopeType:       "project",
		ScopeID:         uuid.New(),
		ActorUserID:     uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing selector, got %v", err)
	}

	_, err = service.CreateGrant(context.Background(), CreateGrantInput{
		SubjectUserID:   uuid.New(),
		Email:           "expert@example.com",
		TemplateCode:    "shared_viewer",
		PermissionCodes: []string{"project.view"},
		ScopeType:       "project",
		ScopeID:         uuid.New(),
		ActorUserID:     uuid.New(),
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

func TestGrantCoversNestedDeviceScope(t *testing.T) {
	workspaceID, projectID, siteID, deviceID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	target := resolvedScope{workspaceID: workspaceID, projectID: projectID, siteID: siteID, deviceID: deviceID, scopeType: "device", scopeID: deviceID}
	for _, grant := range []AccessGrant{
		{ScopeType: "workspace", ScopeID: workspaceID},
		{ScopeType: "project", ScopeID: projectID},
		{ScopeType: "site", ScopeID: siteID},
		{ScopeType: "device", ScopeID: deviceID},
	} {
		if !grantCoversScope(grant, target) {
			t.Fatalf("expected %#v to cover device target", grant)
		}
	}
	if grantCoversScope(AccessGrant{ScopeType: "site", ScopeID: uuid.New()}, target) {
		t.Fatal("unexpected unrelated site scope coverage")
	}
}

func TestPermissionSubset(t *testing.T) {
	available := []string{"device.view", "share.create", "telemetry.view_history"}
	if !permissionSubset([]string{"device.view", "telemetry.view_history"}, available) {
		t.Fatal("expected requested permissions to be a subset")
	}
	if permissionSubset([]string{"device.configure"}, available) {
		t.Fatal("expected elevated permission to be rejected")
	}
}
