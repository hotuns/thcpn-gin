package permission

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/db/sqlc"
)

type fakePermissionStore struct {
	workspaceAllowed bool
	grantAllowed     bool
	err              error
	workspaceArg     sqlc.HasWorkspacePermissionParams
	grantArg         sqlc.HasAccessGrantPermissionParams
	dataset          sqlc.Dataset
	project          sqlc.Project
	site             sqlc.Site
	device           sqlc.Device
	dataStream       sqlc.DataStream
}

func (f *fakePermissionStore) HasWorkspacePermission(_ context.Context, arg sqlc.HasWorkspacePermissionParams) (bool, error) {
	f.workspaceArg = arg
	if f.err != nil {
		return false, f.err
	}
	return f.workspaceAllowed, nil
}

func (f *fakePermissionStore) HasAccessGrantPermission(_ context.Context, arg sqlc.HasAccessGrantPermissionParams) (bool, error) {
	f.grantArg = arg
	if f.err != nil {
		return false, f.err
	}
	return f.grantAllowed, nil
}

func (f *fakePermissionStore) GetProject(_ context.Context, id uuid.UUID) (sqlc.Project, error) {
	f.project.ID = id
	return f.project, nil
}

func (f *fakePermissionStore) GetDataset(_ context.Context, id uuid.UUID) (sqlc.Dataset, error) {
	f.dataset.ID = id
	return f.dataset, nil
}

func (f *fakePermissionStore) GetSite(_ context.Context, id uuid.UUID) (sqlc.Site, error) {
	f.site.ID = id
	return f.site, nil
}

func (f *fakePermissionStore) GetDevice(_ context.Context, id uuid.UUID) (sqlc.Device, error) {
	f.device.ID = id
	return f.device, nil
}

func (f *fakePermissionStore) GetDataStream(_ context.Context, id uuid.UUID) (sqlc.DataStream, error) {
	f.dataStream.ID = id
	return f.dataStream, nil
}

func TestCheckerAllowsWorkspacePermission(t *testing.T) {
	store := &fakePermissionStore{workspaceAllowed: true}
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
	if store.workspaceArg.UserID != userID || store.workspaceArg.WorkspaceID != workspaceID || store.workspaceArg.Code != "workspace.view" {
		t.Fatalf("unexpected store arg: %#v", store.workspaceArg)
	}
}

func TestCheckerDeniesMissingMembershipPermission(t *testing.T) {
	checker := NewChecker(&fakePermissionStore{workspaceAllowed: false})

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
	checker := NewChecker(&fakePermissionStore{workspaceAllowed: true})

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "workspace.view", ResourceRef{
		Type: "unknown",
		ID:   uuid.New(),
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if decision.Allowed || decision.Reason != "unsupported resource type" {
		t.Fatalf("expected unsupported resource denial, got %#v", decision)
	}
}

func TestCheckerAllowsProjectAccessGrant(t *testing.T) {
	workspaceID := uuid.New()
	projectID := uuid.New()
	userID := uuid.New()
	store := &fakePermissionStore{
		grantAllowed: true,
		project: sqlc.Project{
			ID:          projectID,
			WorkspaceID: workspaceID,
		},
	}
	checker := NewChecker(store)

	decision, err := checker.Can(context.Background(), Actor{UserID: userID}, "project.view", ResourceRef{
		Type: "project",
		ID:   projectID,
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected allowed decision, got %#v", decision)
	}
	if store.workspaceArg.WorkspaceID != workspaceID {
		t.Fatalf("expected workspace permission to use resolved workspace id, got %#v", store.workspaceArg)
	}
	if store.grantArg.ProjectID != projectID || store.grantArg.ScopeType != "project" || store.grantArg.ScopeID != projectID {
		t.Fatalf("unexpected grant arg: %#v", store.grantArg)
	}
}

func TestCheckerAllowsProjectGrantForDataset(t *testing.T) {
	workspaceID := uuid.New()
	projectID := uuid.New()
	datasetID := uuid.New()
	store := &fakePermissionStore{
		grantAllowed: true,
		dataset: sqlc.Dataset{
			ID:          datasetID,
			WorkspaceID: workspaceID,
			ProjectID:   &projectID,
		},
	}
	checker := NewChecker(store)

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "dataset.view", ResourceRef{
		Type: "dataset",
		ID:   datasetID,
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected allowed decision, got %#v", decision)
	}
	if store.grantArg.DatasetID != datasetID || store.grantArg.ProjectID != projectID {
		t.Fatalf("unexpected grant arg: %#v", store.grantArg)
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
