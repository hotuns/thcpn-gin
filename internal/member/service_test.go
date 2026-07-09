package member

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestAddRequiresInternalRole(t *testing.T) {
	service := NewService(nil)

	_, err := service.Add(context.Background(), AddInput{
		WorkspaceID:     uuid.New(),
		Email:           "member@example.com",
		TemplateCode:    "shared_viewer",
		PermissionCodes: []string{"workspace.view"},
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestAddRequiresExactlyOneUserSelector(t *testing.T) {
	service := NewService(nil)

	_, err := service.Add(context.Background(), AddInput{
		WorkspaceID:     uuid.New(),
		TemplateCode:    "viewer",
		PermissionCodes: []string{"workspace.view"},
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing selector, got %v", err)
	}

	_, err = service.Add(context.Background(), AddInput{
		WorkspaceID:     uuid.New(),
		UserID:          uuid.New(),
		Email:           "member@example.com",
		TemplateCode:    "viewer",
		PermissionCodes: []string{"workspace.view"},
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for multiple selectors, got %v", err)
	}
}

func TestInternalMemberRoles(t *testing.T) {
	for _, role := range []string{"owner", "admin", "project_manager", "site_operator", "data_manager", "researcher", "viewer"} {
		if !isInternalMemberRole(role) {
			t.Fatalf("expected %q to be internal member role", role)
		}
	}

	for _, role := range []string{"shared_viewer", "shared_downloader", "service_engineer"} {
		if isInternalMemberRole(role) {
			t.Fatalf("expected %q to be rejected for workspace members", role)
		}
	}
}

func TestNormalizeScopeDefaultsWorkspace(t *testing.T) {
	workspaceID := uuid.New()

	scopeType, scopeID, err := normalizeScope(context.Background(), nil, workspaceID, "viewer", "", uuid.Nil)
	if err != nil {
		t.Fatalf("normalize scope: %v", err)
	}
	if scopeType != "workspace" || scopeID != workspaceID {
		t.Fatalf("unexpected scope: %s %s", scopeType, scopeID)
	}
}

func TestNormalizeScopeRequiresOwnerWorkspaceScope(t *testing.T) {
	_, _, err := normalizeScope(context.Background(), nil, uuid.New(), "owner", "project", uuid.New())
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
