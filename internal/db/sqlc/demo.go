package sqlc

import (
	"context"

	"github.com/google/uuid"
)

func (q *Queries) IsDemoDeviceForUser(ctx context.Context, userID, deviceID uuid.UUID) (bool, error) {
	var allowed bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM demo_showcase_devices dsd
		JOIN users u ON u.id = dsd.user_id AND u.is_demo = true AND u.status = 'active'
		WHERE dsd.user_id = $1 AND (
			dsd.device_id = $2 OR EXISTS (
				SELECT 1 FROM device_relations dr
				WHERE dr.parent_device_id = dsd.device_id
				  AND dr.child_device_id = $2
				  AND dr.relation_type = 'gateway_node'
				  AND dr.status = 'active'
			)
		)
	)`, userID, deviceID).Scan(&allowed)
	return allowed, err
}

func (q *Queries) IsDemoWorkspaceForUser(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error) {
	var allowed bool
	err := q.db.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM workspaces w
		JOIN users u ON u.id = w.owner_user_id AND u.is_demo = true AND u.status = 'active'
		WHERE w.id = $2 AND w.is_demo_workspace = true AND u.id = $1
	)`, userID, workspaceID).Scan(&allowed)
	return allowed, err
}
