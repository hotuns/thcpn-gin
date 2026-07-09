package permission

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/db/sqlc"
)

type fakePermissionStore struct {
	memberAllowed    bool
	memberRoleCode   string
	grantAllowed     bool
	grantRoleCode    string
	err              error
	memberArg        sqlc.GetWorkspaceMemberPermissionRoleParams
	grantArg         sqlc.GetAccessGrantPermissionRoleParams
	dataset          sqlc.Dataset
	project          sqlc.Project
	site             sqlc.Site
	device           sqlc.Device
	deviceAssignment sqlc.DeviceAssignment
	dataStream       sqlc.DataStream
}

func (f *fakePermissionStore) GetWorkspaceMemberPermissionRole(_ context.Context, arg sqlc.GetWorkspaceMemberPermissionRoleParams) (string, error) {
	f.memberArg = arg
	if f.err != nil {
		return "", f.err
	}
	if !f.memberAllowed {
		return "", pgx.ErrNoRows
	}
	if f.memberRoleCode != "" {
		return f.memberRoleCode, nil
	}
	return "viewer", nil
}

func (f *fakePermissionStore) GetAccessGrantPermissionRole(_ context.Context, arg sqlc.GetAccessGrantPermissionRoleParams) (string, error) {
	f.grantArg = arg
	if f.err != nil {
		return "", f.err
	}
	if !f.grantAllowed {
		return "", pgx.ErrNoRows
	}
	if f.grantRoleCode != "" {
		return f.grantRoleCode, nil
	}
	return "shared_viewer", nil
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

func (f *fakePermissionStore) GetActiveDeviceAssignment(_ context.Context, deviceID uuid.UUID) (sqlc.DeviceAssignment, error) {
	f.deviceAssignment.DeviceID = deviceID
	return f.deviceAssignment, nil
}

func (f *fakePermissionStore) GetActiveDeviceAssignmentByDataStream(_ context.Context, id uuid.UUID) (sqlc.DeviceAssignment, error) {
	f.deviceAssignment.DeviceID = f.dataStream.DeviceID
	return f.deviceAssignment, nil
}

func (f *fakePermissionStore) GetDataStream(_ context.Context, id uuid.UUID) (sqlc.DataStream, error) {
	f.dataStream.ID = id
	return f.dataStream, nil
}

func TestCheckerAllowsWorkspacePermission(t *testing.T) {
	store := &fakePermissionStore{memberAllowed: true, memberRoleCode: "admin"}
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
	if decision.Source != "workspace_member" {
		t.Fatalf("expected workspace member source, got %#v", decision)
	}
	if decision.GrantRoleCode != "admin" {
		t.Fatalf("expected member role code, got %#v", decision)
	}
	if store.memberArg.UserID != userID || store.memberArg.WorkspaceID != workspaceID || store.memberArg.Code != "workspace.view" {
		t.Fatalf("unexpected store arg: %#v", store.memberArg)
	}
	if store.memberArg.ScopeType != "workspace" || store.memberArg.ScopeID != workspaceID {
		t.Fatalf("unexpected member scope arg: %#v", store.memberArg)
	}
}

func TestCheckerDeniesMissingMembershipPermission(t *testing.T) {
	checker := NewChecker(&fakePermissionStore{memberAllowed: false})

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
	checker := NewChecker(&fakePermissionStore{memberAllowed: true})

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
	if decision.Source != "access_grant" || decision.GrantRoleCode != "shared_viewer" {
		t.Fatalf("expected access grant decision metadata, got %#v", decision)
	}
	if store.memberArg.WorkspaceID != workspaceID {
		t.Fatalf("expected workspace permission to use resolved workspace id, got %#v", store.memberArg)
	}
	if store.grantArg.ProjectID != projectID || store.grantArg.ScopeType != "project" || store.grantArg.ScopeID != projectID {
		t.Fatalf("unexpected grant arg: %#v", store.grantArg)
	}
}

func TestCheckerPassesProjectScopeToWorkspaceMemberPermission(t *testing.T) {
	workspaceID := uuid.New()
	projectID := uuid.New()
	userID := uuid.New()
	store := &fakePermissionStore{
		memberAllowed: true,
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
	if !decision.Allowed || decision.Source != "workspace_member" {
		t.Fatalf("expected workspace member decision, got %#v", decision)
	}
	if store.memberArg.ScopeType != "project" || store.memberArg.ScopeID != projectID || store.memberArg.ProjectID != projectID {
		t.Fatalf("unexpected member arg: %#v", store.memberArg)
	}
	if store.grantArg.SubjectID != uuid.Nil {
		t.Fatalf("expected access grant not to be checked after member allow, got %#v", store.grantArg)
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

func TestCheckerPassesDeviceAndSiteScopeToWorkspaceMemberPermission(t *testing.T) {
	workspaceID := uuid.New()
	projectID := uuid.New()
	siteID := uuid.New()
	deviceID := uuid.New()
	store := &fakePermissionStore{
		memberAllowed: true,
		device: sqlc.Device{
			ID: deviceID,
		},
		deviceAssignment: sqlc.DeviceAssignment{
			WorkspaceID: workspaceID,
			ProjectID:   &projectID,
			SiteID:      &siteID,
		},
	}
	checker := NewChecker(store)

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "device.view", ResourceRef{
		Type: "device",
		ID:   deviceID,
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if !decision.Allowed {
		t.Fatalf("expected allowed decision, got %#v", decision)
	}
	if store.memberArg.DeviceID != deviceID || store.memberArg.SiteID != siteID || store.memberArg.ProjectID != projectID {
		t.Fatalf("unexpected member arg: %#v", store.memberArg)
	}
}

func TestCheckerPassesDatasetScopeToWorkspaceMemberPermission(t *testing.T) {
	workspaceID := uuid.New()
	projectID := uuid.New()
	datasetID := uuid.New()
	store := &fakePermissionStore{
		memberAllowed: true,
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
	if store.memberArg.DatasetID != datasetID || store.memberArg.ProjectID != projectID || store.memberArg.ScopeType != "dataset" {
		t.Fatalf("unexpected member arg: %#v", store.memberArg)
	}
}

func TestCheckerReturnsAccessGrantRoleCode(t *testing.T) {
	workspaceID := uuid.New()
	deviceID := uuid.New()
	store := &fakePermissionStore{
		grantAllowed:  true,
		grantRoleCode: "service_engineer",
		device: sqlc.Device{
			ID: deviceID,
		},
		deviceAssignment: sqlc.DeviceAssignment{
			WorkspaceID: workspaceID,
		},
	}
	checker := NewChecker(store)

	decision, err := checker.Can(context.Background(), Actor{UserID: uuid.New()}, "device.view", ResourceRef{
		Type: "device",
		ID:   deviceID,
	})
	if err != nil {
		t.Fatalf("check permission: %v", err)
	}
	if !decision.Allowed || decision.Source != "access_grant" || decision.GrantRoleCode != "service_engineer" {
		t.Fatalf("expected service engineer grant metadata, got %#v", decision)
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
