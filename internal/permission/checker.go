package permission

import (
	"context"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel/attribute"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/tracing"
)

type Store interface {
	GetDataStream(ctx context.Context, id uuid.UUID) (sqlc.DataStream, error)
	GetDataset(ctx context.Context, id uuid.UUID) (sqlc.Dataset, error)
	GetDevice(ctx context.Context, id uuid.UUID) (sqlc.Device, error)
	GetProject(ctx context.Context, id uuid.UUID) (sqlc.Project, error)
	GetSite(ctx context.Context, id uuid.UUID) (sqlc.Site, error)
	HasAccessGrantPermission(ctx context.Context, arg sqlc.HasAccessGrantPermissionParams) (bool, error)
	HasWorkspacePermission(ctx context.Context, arg sqlc.HasWorkspacePermissionParams) (bool, error)
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
	Allowed bool
	Reason  string
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

	scope, err := c.resolveResource(ctx, resource)
	if err != nil {
		return Decision{}, err
	}
	if scope.WorkspaceID == uuid.Nil {
		return Decision{Allowed: false, Reason: "unsupported resource type"}, nil
	}

	allowed, err := c.store.HasWorkspacePermission(ctx, sqlc.HasWorkspacePermissionParams{
		UserID:      actor.UserID,
		WorkspaceID: scope.WorkspaceID,
		Code:        action,
	})
	if err != nil {
		return Decision{}, apperr.Wrap(apperr.KindInternal, "check workspace permission", err)
	}
	if allowed {
		return Decision{Allowed: true, Reason: "allowed by workspace membership"}, nil
	}

	allowed, err = c.store.HasAccessGrantPermission(ctx, sqlc.HasAccessGrantPermissionParams{
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
		return Decision{}, apperr.Wrap(apperr.KindInternal, "check access grant permission", err)
	}
	if allowed {
		return Decision{Allowed: true, Reason: "allowed by access grant"}, nil
	}

	return Decision{Allowed: false, Reason: "permission denied"}, nil
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
		scope := resourceScope{
			WorkspaceID: device.WorkspaceID,
			ScopeType:   "device",
			ScopeID:     device.ID,
			DeviceID:    device.ID,
		}
		if device.ProjectID != nil {
			scope.ProjectID = *device.ProjectID
		}
		if device.SiteID != nil {
			scope.SiteID = *device.SiteID
		}
		return scope, nil
	case "data_stream":
		stream, err := c.store.GetDataStream(ctx, resource.ID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "data stream not found", err)
		}
		device, err := c.store.GetDevice(ctx, stream.DeviceID)
		if err != nil {
			return resourceScope{}, apperr.Wrap(apperr.KindNotFound, "device not found", err)
		}
		scope := resourceScope{
			WorkspaceID: stream.WorkspaceID,
			ScopeType:   "data_stream",
			ScopeID:     stream.ID,
			DeviceID:    stream.DeviceID,
		}
		if device.ProjectID != nil {
			scope.ProjectID = *device.ProjectID
		}
		if device.SiteID != nil {
			scope.SiteID = *device.SiteID
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
