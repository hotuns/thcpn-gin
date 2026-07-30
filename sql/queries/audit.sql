-- name: CreateAuditLog :one
INSERT INTO audit_logs (
    workspace_id,
    actor_type,
    actor_id,
    action,
    resource_type,
    resource_id,
    result,
    reason,
    ip,
    user_agent,
    request_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, result, reason, ip, user_agent, request_id, created_at, actor_admin_id;

-- name: ListAuditLogsByWorkspace :many
SELECT id, workspace_id, actor_type, actor_id, action, resource_type, resource_id, result, reason, ip, user_agent, request_id, created_at, actor_admin_id
FROM audit_logs
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;
