package sqlc

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type WorkspaceDeviceContext struct {
	WorkspaceID uuid.UUID
	ProjectID   *uuid.UUID
	SiteID      *uuid.UUID
	Referenced  bool
}

// GetWorkspaceDeviceContext resolves a device through the current user's workspace.
// Demo references take precedence over the device's real assignment, while regular
// users continue to use the existing assignment model.
func (q *Queries) GetWorkspaceDeviceContext(ctx context.Context, userID, deviceID uuid.UUID) (WorkspaceDeviceContext, error) {
	var result WorkspaceDeviceContext
	err := q.db.QueryRow(ctx, `
		SELECT dsd.workspace_id, dsd.project_id, dsd.site_id, true
		FROM demo_showcase_devices dsd
		JOIN users u ON u.id = dsd.user_id AND u.is_demo = true AND u.status = 'active'
		WHERE dsd.user_id = $1 AND (
			dsd.device_id = $2 OR EXISTS (
				SELECT 1 FROM device_relations dr
				WHERE dr.parent_device_id = dsd.device_id AND dr.child_device_id = $2
				  AND dr.relation_type = 'gateway_node' AND dr.status = 'active'
			)
		)
		LIMIT 1`, userID, deviceID).Scan(&result.WorkspaceID, &result.ProjectID, &result.SiteID, &result.Referenced)
	if err == nil {
		return result, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceDeviceContext{}, err
	}
	assignment, err := q.GetActiveDeviceAssignment(ctx, deviceID)
	if err != nil {
		return WorkspaceDeviceContext{}, err
	}
	return WorkspaceDeviceContext{WorkspaceID: assignment.WorkspaceID, ProjectID: assignment.ProjectID, SiteID: assignment.SiteID}, nil
}
