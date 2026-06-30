-- name: HasWorkspacePermission :one
SELECT EXISTS (
    SELECT 1
    FROM workspace_members wm
    JOIN roles r ON r.id = wm.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE wm.user_id = $1
      AND wm.workspace_id = $2
      AND wm.status = 'active'
      AND p.code = $3
      AND (r.workspace_id IS NULL OR r.workspace_id = wm.workspace_id)
) AS allowed;
