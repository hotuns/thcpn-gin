package permission

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/db/sqlc"
)

type fakePermissionStore struct {
	allowed bool
	err     error
	arg     sqlc.HasWorkspacePermissionParams
}

func (f *fakePermissionStore) HasWorkspacePermission(_ context.Context, arg sqlc.HasWorkspacePermissionParams) (bool, error) {
	f.arg = arg
	if f.err != nil {
		return false, f.err
	}
	return f.allowed, nil
}

func TestCheckerAllowsWorkspacePermission(t *testing.T) {
	store := &fakePermissionStore{allowed: true}
	checker := NewChecker(store)
	userID := uuid.New()
	workspaceID := uuid.New()

	decision, err := checker.Can(context.Background(), Actor{UserID: userID}, "workspace.view", ResourceRef{
		Type: "workspace",
		ID:   workspaceID,
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected allowed decision, got %#v", decision)
	}
	if store.arg.UserID != userID || store.arg.WorkspaceID != workspaceID || store.arg.Code != "workspace.view" {
		t.Fatalf("unexpected store arg: %#v", store.arg)
	}
}

func TestCheckerDeniesMissingMembershipPermission(t *testing.T) {
	checker := NewChecker(&fakePermissionStore{allowed: false})

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "workspace.manage", ResourceRef{
		Type: "workspace",
		ID:   uuid.New(),
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if decision.Allowed {
		t.Fatalf("expected denied decision, got %#v", decision)
	}
}

func TestCheckerRejectsUnsupportedResource(t *testing.T) {
	checker := NewChecker(&fakePermissionStore{allowed: true})

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "workspace.view", ResourceRef{
		Type: "project",
		ID:   uuid.New(),
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if decision.Allowed || decision.Reason != "unsupported resource type" {
		t.Fatalf("expected unsupported resource denial, got %#v", decision)
	}
}

func TestCheckerReturnsStoreError(t *testing.T) {
	checker := NewChecker(&fakePermissionStore{err: errors.New("db failed")})

	_, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "workspace.view", ResourceRef{
		Type: "workspace",
		ID:   uuid.New(),
	})
	if err == nil {
		t.Fatal("expected error")
	}
}
