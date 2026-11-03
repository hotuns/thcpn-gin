package devicescope

import (
	"context"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
)

// Resolve keeps a showcase device in the authenticated demo user's workspace
// for entitlement checks and user-owned resources. The real assignment remains
// authoritative for ordinary users and background device operations.
func Resolve(ctx context.Context, queries *sqlc.Queries, deviceID uuid.UUID) (sqlc.WorkspaceDeviceContext, error) {
	if actor, ok := auth.ActorInContext(ctx); ok && actor.IsDemo {
		placement, err := queries.GetWorkspaceDeviceContext(ctx, actor.UserID, deviceID)
		if err != nil {
			return sqlc.WorkspaceDeviceContext{}, err
		}
		if !placement.Referenced {
			return sqlc.WorkspaceDeviceContext{}, apperr.New(apperr.KindPermissionDenied, "device is not included in this demo workspace")
		}
		return placement, nil
	}
	assignment, err := queries.GetActiveDeviceAssignment(ctx, deviceID)
	if err != nil {
		return sqlc.WorkspaceDeviceContext{}, err
	}
	return sqlc.WorkspaceDeviceContext{WorkspaceID: assignment.WorkspaceID, ProjectID: assignment.ProjectID, SiteID: assignment.SiteID}, nil
}
