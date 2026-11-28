package app

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

func liteDisabled(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "this feature is disabled in lite deployment"))
}

func liteGate(lite bool, next gin.HandlerFunc) gin.HandlerFunc {
	if lite {
		return liteDisabled
	}
	return next
}

// autoAssignUnassignedDevices assigns any newly created or synced devices without a workspace
// to the single default workspace in onprem-lite deployments.
func autoAssignUnassignedDevices(ctx context.Context, pool *pgxpool.Pool, workspaceID uuid.UUID) {
	if pool == nil || workspaceID == uuid.Nil {
		return
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1 AND status = 'active')`, workspaceID).Scan(&exists); err != nil || !exists {
		return
	}
	rows, err := tx.Query(ctx, `SELECT id FROM devices WHERE workspace_id IS NULL`)
	if err != nil {
		return
	}
	var deviceIDs []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			deviceIDs = append(deviceIDs, id)
		}
	}
	rows.Close()
	if len(deviceIDs) == 0 {
		return
	}
	for _, devID := range deviceIDs {
		if _, err := tx.Exec(ctx, `
			INSERT INTO device_assignments (device_id, workspace_id, status, assigned_by_type)
			SELECT $1, $2, 'active', 'system'
			WHERE NOT EXISTS (
				SELECT 1 FROM device_assignments WHERE device_id = $1 AND status = 'active'
			)
		`, devID, workspaceID); err != nil {
			return
		}
		if _, err := tx.Exec(ctx, `UPDATE devices SET workspace_id = $2, updated_at = now() WHERE id = $1 AND workspace_id IS NULL`, devID, workspaceID); err != nil {
			return
		}
	}
	_ = tx.Commit(ctx)
}

func liteAutoAssignMiddleware(pool *pgxpool.Pool, workspaceID uuid.UUID) gin.HandlerFunc {
	if pool == nil || workspaceID == uuid.Nil {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		c.Next()
		if c.Writer.Status() >= 200 && c.Writer.Status() < 400 {
			autoAssignUnassignedDevices(c.Request.Context(), pool, workspaceID)
		}
	}
}
