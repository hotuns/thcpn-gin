package permission

import (
	"context"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

type Store interface {
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

func NewChecker(store Store) *Checker {
	return &Checker{store: store}
}

func (c *Checker) Can(ctx context.Context, actor Actor, action string, resource ResourceRef) (Decision, error) {
	if actor.UserID == uuid.Nil {
		return Decision{Allowed: false, Reason: "missing actor"}, nil
	}
	if action == "" {
		return Decision{Allowed: false, Reason: "missing action"}, nil
	}
	if resource.Type != "workspace" {
		return Decision{Allowed: false, Reason: "unsupported resource type"}, nil
	}
	if resource.ID == uuid.Nil {
		return Decision{Allowed: false, Reason: "missing resource"}, nil
	}
	if c.store == nil {
		return Decision{}, apperr.New(apperr.KindInternal, "permission checker store is not configured")
	}

	allowed, err := c.store.HasWorkspacePermission(ctx, sqlc.HasWorkspacePermissionParams{
		UserID:      actor.UserID,
		WorkspaceID: resource.ID,
		Code:        action,
	})
	if err != nil {
		return Decision{}, apperr.Wrap(apperr.KindInternal, "check workspace permission", err)
	}
	if !allowed {
		return Decision{Allowed: false, Reason: "permission denied"}, nil
	}

	return Decision{Allowed: true, Reason: "allowed"}, nil
}
