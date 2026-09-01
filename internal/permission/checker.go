package permission

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel/attribute"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/tracing"
)

type Store interface {
	GetActiveDeviceAssignment(ctx context.Context, deviceID uuid.UUID) (sqlc.DeviceAssignment, error)
	GetActiveDeviceAssignmentByDataStream(ctx context.Context, id uuid.UUID) (sqlc.DeviceAssignment, error)
	GetDataStream(ctx context.Context, id uuid.UUID) (sqlc.DataStream, error)
	GetDataset(ctx context.Context, id uuid.UUID) (sqlc.Dataset, error)
	GetDevice(ctx context.Context, id uuid.UUID) (sqlc.Device, error)
	GetProject(ctx context.Context, id uuid.UUID) (sqlc.Project, error)
	GetSite(ctx context.Context, id uuid.UUID) (sqlc.Site, error)
	GetAccessGrantPermissionRole(ctx context.Context, arg sqlc.GetAccessGrantPermissionRoleParams) (string, error)
	GetWorkspaceMemberPermissionRole(ctx context.Context, arg sqlc.GetWorkspaceMemberPermissionRoleParams) (string, error)
}

type demoStore interface {
	IsDemoDeviceForUser(ctx context.Context, userID, deviceID uuid.UUID) (bool, error)
}

type Checker struct {
	store Store
}

type Actor struct {
	UserID uuid.UUID
}

type ResourceRef struct {
	Type string
	ID   uuid.UUID
}

type Decision struct {
	Allowed       bool
	Reason        string
	Source        string
	GrantRoleCode string
}

type resourceScope struct {
	WorkspaceID uuid.UUID
	ScopeType   string
	ScopeID     uuid.UUID
	ProjectID   uuid.UUID
	SiteID      uuid.UUID
	DeviceID    uuid.UUID
	DatasetID   uuid.UUID
}

func NewChecker(store Store) *Checker {
	return &Checker{store: store}
}

func (c *Checker) Can(ctx context.Context, actor Actor, action string, resource ResourceRef) (decision Decision, err error) {
	ctx, span := tracing.Start(ctx, "permission.check",
		attribute.String("permission.action", action),
		attribute.String("resource.type", resource.Type),
		attribute.String("resource.id", resource.ID.String()),
		attribute.String("actor.user_id", actor.UserID.String()),
	)
	defer func() {
		span.SetAttributes(
			attribute.Bool("permission.allowed", decision.Allowed),
			attribute.String("permission.reason", decision.Reason),
		)
		tracing.End(span, err)
	}()

	if actor.UserID == uuid.Nil {
		return Decision{Allowed: false, Reason: "missing actor"}, nil
	}
	if action == "" {
		return Decision{Allowed: false, Reason: "missing action"}, nil
	}
	if resource.ID == uuid.Nil {
		return Decision{Allowed: false, Reason: "missing resource"}, nil
	}
	if c.store == nil {
		return Decision{}, apperr.New(apperr.KindInternal, "permission checker store is not configured")
	}
	if resource.Type == "device" {
		if decision, checked, checkErr := c.demoDecision(ctx, actor.UserID, resource.ID, action); checked || checkErr != nil {
			return decision, checkErr
		}
	}

	scope, err := c.resolveResource(ctx, resource)
	if err != nil {
		return Decision{}, err
	}
	if scope.WorkspaceID == uuid.Nil {
		return Decision{Allowed: false, Reason: "unsupported resource type"}, nil
	}
	if scope.DeviceID != uuid.Nil {
		demoChecker, supportsDemo := c.store.(demoStore)
		demoDevice := false
		var checkErr error
		if supportsDemo {
			demoDevice, checkErr = demoChecker.IsDemoDeviceForUser(ctx, actor.UserID, scope.DeviceID)
		}
		if checkErr != nil {
			return Decision{}, apperr.Wrap(apperr.KindInternal, "check demo device access", checkErr)
		}
		if demoDevice {
			switch action {
			case "device.bind", "device.transfer", "device.unbind", "media.delete":
				return Decision{Allowed: false, Reason: "demo account destructive action denied", Source: "demo_showcase"}, nil
			default:
				return Decision{Allowed: true, Reason: "allowed by demo showcase", Source: "demo_showcase"}, nil
			}
		}
	}

	memberRoleCode, err := c.store.GetWorkspaceMemberPermissionRole(ctx, sqlc.GetWorkspaceMemberPermissionRoleParams{
		UserID:      actor.UserID,
		WorkspaceID: scope.WorkspaceID,
		Code:        action,
		ScopeType:   scope.ScopeType,
		ScopeID:     scope.ScopeID,
		ProjectID:   scope.ProjectID,
		SiteID:      scope.SiteID,
		DeviceID:    scope.DeviceID,
		DatasetID:   scope.DatasetID,
	})
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return Decision{}, apperr.Wrap(apperr.KindInternal, "check workspace member permission", err)
		}
	}
	if memberRoleCode != "" {
		return Decision{Allowed: true, Reason: "allowed by workspace membership", Source: "workspace_member", GrantRoleCode: memberRoleCode}, nil
	}

	grantRoleCode, err := c.store.GetAccessGrantPermissionRole(ctx, sqlc.GetAccessGrantPermissionRoleParams{
		SubjectID:   actor.UserID,
		WorkspaceID: scope.WorkspaceID,
		Code:        action,
		ScopeType:   scope.ScopeType,
		ScopeID:     scope.ScopeID,
		ProjectID:   scope.ProjectID,
		SiteID:      scope.SiteID,
		DeviceID:    scope.DeviceID,
		DatasetID:   scope.DatasetID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Decision{Allowed: false, Reason: "permission denied"}, nil
		}
		return Decision{}, apperr.Wrap(apperr.KindInternal, "check access grant permission", err)
	}
	if grantRoleCode != "" {
		return Decision{Allowed: true, Reason: "allowed by access grant", Source: "access_grant", GrantRoleCode: grantRoleCode}, nil
	}

	return Decision{Allowed: false, Reason: "permission denied"}, nil
}

func (c *Checker) demoDecision(ctx context.Context, userID, deviceID uuid.UUID, action string) (Decision, bool, error) {
	demoChecker, ok := c.store.(demoStore)
	if !ok {
		return Decision{}, false, nil
	}
	selected, err := demoChecker.IsDemoDeviceForUser(ctx, userID, deviceID)
	if err != nil {
		return Decision{}, true, apperr.Wrap(apperr.KindInternal, "check demo device access", err)
	}
	if !selected {
		return Decision{}, false, nil
	}
	switch action {
	case "device.bind", "device.transfer", "device.unbind", "media.delete":
		return Decision{Allowed: false, Reason: "demo account destructive action denied", Source: "demo_showcase"}, true, nil
	default:
		return Decision{Allowed: true, Reason: "allowed by demo showcase", Source: "demo_showcase"}, true, nil
	}
}

func (c *Checker) resolveResource(ctx context.Context, resource ResourceRef) (resourceScope, error) {
	switch resource.Type {
	case "workspace":
		return resourceScope{
			WorkspaceID: resource.ID,
			ScopeType:   "workspace",
			ScopeID:     resource.ID,
		}, nil
	case "project":
		project, err := c.store.GetProject(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "project not found", err)
		}
		return resourceScope{
			WorkspaceID: project.WorkspaceID,
			ScopeType:   "project",
			ScopeID:     project.ID,
			ProjectID:   project.ID,
		}, nil
	case "site":
		site, err := c.store.GetSite(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "site not found", err)
		}
		return resourceScope{
			WorkspaceID: site.WorkspaceID,
			ScopeType:   "site",
			ScopeID:     site.ID,
			ProjectID:   site.ProjectID,
			SiteID:      site.ID,
		}, nil
	case "device":
		device, err := c.store.GetDevice(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "device not found", err)
		}
		assignment, err := c.store.GetActiveDeviceAssignment(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "active device assignment not found", err)
		}
		scope := resourceScope{
			WorkspaceID: assignment.WorkspaceID,
			ScopeType:   "device",
			ScopeID:     device.ID,
			DeviceID:    device.ID,
		}
		if assignment.ProjectID != nil {
			scope.ProjectID = *assignment.ProjectID
		}
		if assignment.SiteID != nil {
			scope.SiteID = *assignment.SiteID
		}
		return scope, nil
	case "data_stream":
		stream, err := c.store.GetDataStream(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "data stream not found", err)
		}
		assignment, err := c.store.GetActiveDeviceAssignmentByDataStream(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "active device assignment not found", err)
		}
		scope := resourceScope{
			WorkspaceID: assignment.WorkspaceID,
			ScopeType:   "data_stream",
			ScopeID:     stream.ID,
			DeviceID:    stream.DeviceID,
		}
		if assignment.ProjectID != nil {
			scope.ProjectID = *assignment.ProjectID
		}
		if assignment.SiteID != nil {
			scope.SiteID = *assignment.SiteID
		}
		return scope, nil
	case "dataset":
		dataset, err := c.store.GetDataset(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "dataset not found", err)
		}
		scope := resourceScope{
			WorkspaceID: dataset.WorkspaceID,
			ScopeType:   "dataset",
			ScopeID:     dataset.ID,
			DatasetID:   dataset.ID,
		}
		if dataset.ProjectID != nil {
			scope.ProjectID = *dataset.ProjectID
		}
		return scope, nil
	default:
		return resourceScope{}, nil
	}
}
