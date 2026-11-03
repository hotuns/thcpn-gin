-- name: IsDemoWorkspaceOwner :one
SELECT EXISTS (
    SELECT 1 FROM users u
    JOIN workspaces w ON w.owner_user_id = u.id
    WHERE u.id = sqlc.arg(user_id)::uuid AND u.is_demo = true AND u.status = 'active'
      AND w.id = sqlc.arg(workspace_id)::uuid AND w.is_demo_workspace = true AND w.status = 'active'
) AS allowed;

-- name: HasWorkspacePermission :one
SELECT EXISTS (
    SELECT 1
    FROM workspace_members wm
    JOIN workspace_member_permissions wmp ON wmp.member_id = wm.id
    JOIN permissions p ON p.id = wmp.permission_id
    WHERE wm.user_id = $1
      AND wm.workspace_id = $2
      AND wm.status = 'active'
      AND p.code = $3
) AS allowed;

-- name: GetWorkspaceMemberPermissionRole :one
SELECT wm.template_code
FROM workspace_members wm
JOIN workspace_member_permissions wmp ON wmp.member_id = wm.id
JOIN permissions p ON p.id = wmp.permission_id
WHERE wm.user_id = $1
  AND wm.workspace_id = $2
  AND wm.status = 'active'
  AND p.code = $3
  AND (
    wm.scope_type = 'workspace'
    OR (wm.scope_type = $4 AND wm.scope_id = $5)
    OR (wm.scope_type = 'project' AND sqlc.arg(project_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(project_id)::uuid)
    OR (wm.scope_type = 'site' AND sqlc.arg(site_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(site_id)::uuid)
    OR (wm.scope_type = 'device' AND sqlc.arg(device_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(device_id)::uuid)
    OR (wm.scope_type = 'dataset' AND sqlc.arg(dataset_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(dataset_id)::uuid)
  )
ORDER BY
  CASE
    WHEN wm.scope_type = $4 AND wm.scope_id = $5 THEN 0
    WHEN wm.scope_type = 'device' AND sqlc.arg(device_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(device_id)::uuid THEN 1
    WHEN wm.scope_type = 'site' AND sqlc.arg(site_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(site_id)::uuid THEN 2
    WHEN wm.scope_type = 'project' AND sqlc.arg(project_id)::uuid IS NOT NULL AND wm.scope_id = sqlc.arg(project_id)::uuid THEN 3
    ELSE 4
  END,
  wm.updated_at DESC,
  wm.id DESC
LIMIT 1;
