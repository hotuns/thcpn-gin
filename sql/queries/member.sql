-- name: ListWorkspaceMembers :many
SELECT
    wm.id,
    wm.workspace_id,
    wm.user_id,
    wm.role_id,
    wm.status,
    wm.joined_at,
    wm.created_at,
    wm.updated_at,
    wm.scope_type,
    wm.scope_id,
    wm.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM workspace_member_permissions wmp
        JOIN permissions p ON p.id = wmp.permission_id
        WHERE wmp.member_id = wm.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    u.name AS user_name,
    u.phone AS user_phone,
    u.email AS user_email,
    u.status AS user_status,
    wm.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = wm.template_code
WHERE wm.workspace_id = $1
  AND wm.status != 'removed'
ORDER BY wm.joined_at ASC;

-- name: GetWorkspaceMemberDetail :one
SELECT
    wm.id,
    wm.workspace_id,
    wm.user_id,
    wm.role_id,
    wm.status,
    wm.joined_at,
    wm.created_at,
    wm.updated_at,
    wm.scope_type,
    wm.scope_id,
    wm.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM workspace_member_permissions wmp
        JOIN permissions p ON p.id = wmp.permission_id
        WHERE wmp.member_id = wm.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    u.name AS user_name,
    u.phone AS user_phone,
    u.email AS user_email,
    u.status AS user_status,
    wm.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = wm.template_code
WHERE wm.workspace_id = $1
  AND wm.id = $2;

-- name: UpdateWorkspaceMemberRole :one
UPDATE workspace_members
SET role_id = $3,
    scope_type = $4,
    scope_id = $5,
    template_code = $6,
    updated_at = now()
WHERE workspace_id = $1
  AND id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at, scope_type, scope_id, template_code;

-- name: UpdateWorkspaceMemberRoleStatusByUser :one
UPDATE workspace_members
SET role_id = $3,
    status = $4,
    scope_type = $5,
    scope_id = $6,
    template_code = $7,
    joined_at = CASE
        WHEN status != 'active' AND $4 = 'active' THEN now()
        ELSE joined_at
    END,
    updated_at = now()
WHERE workspace_id = $1
  AND user_id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at, scope_type, scope_id, template_code;

-- name: RemoveWorkspaceMember :one
UPDATE workspace_members
SET status = 'removed',
    updated_at = now()
WHERE workspace_id = $1
  AND id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at, scope_type, scope_id, template_code;

-- name: CountActiveWorkspaceOwners :one
SELECT count(*)::bigint
FROM workspace_members wm
WHERE wm.workspace_id = $1
  AND wm.status = 'active'
  AND wm.template_code = 'owner';

-- name: DeleteWorkspaceMemberPermissions :exec
DELETE FROM workspace_member_permissions
WHERE member_id = $1;

-- name: AddWorkspaceMemberPermissions :execrows
INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT $1, p.id
FROM permissions p
WHERE p.code = ANY($2::text[])
ON CONFLICT DO NOTHING;

-- name: ListWorkspaceMemberPermissionCodes :many
SELECT p.code
FROM workspace_member_permissions wmp
JOIN permissions p ON p.id = wmp.permission_id
WHERE wmp.member_id = $1
ORDER BY p.resource_type, p.action, p.code;
