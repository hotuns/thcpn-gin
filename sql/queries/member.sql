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
    u.name AS user_name,
    u.phone AS user_phone,
    u.email AS user_email,
    u.status AS user_status,
    r.code AS role_code,
    r.name AS role_name
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
JOIN roles r ON r.id = wm.role_id
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
    u.name AS user_name,
    u.phone AS user_phone,
    u.email AS user_email,
    u.status AS user_status,
    r.code AS role_code,
    r.name AS role_name
FROM workspace_members wm
JOIN users u ON u.id = wm.user_id
JOIN roles r ON r.id = wm.role_id
WHERE wm.workspace_id = $1
  AND wm.id = $2;

-- name: UpdateWorkspaceMemberRole :one
UPDATE workspace_members
SET role_id = $3,
    updated_at = now()
WHERE workspace_id = $1
  AND id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at;

-- name: UpdateWorkspaceMemberRoleStatusByUser :one
UPDATE workspace_members
SET role_id = $3,
    status = $4,
    joined_at = CASE
        WHEN status != 'active' AND $4 = 'active' THEN now()
        ELSE joined_at
    END,
    updated_at = now()
WHERE workspace_id = $1
  AND user_id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at;

-- name: RemoveWorkspaceMember :one
UPDATE workspace_members
SET status = 'removed',
    updated_at = now()
WHERE workspace_id = $1
  AND id = $2
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at;

-- name: CountActiveWorkspaceOwners :one
SELECT count(*)::bigint
FROM workspace_members wm
JOIN roles r ON r.id = wm.role_id
WHERE wm.workspace_id = $1
  AND wm.status = 'active'
  AND r.code = 'owner'
  AND r.workspace_id IS NULL;
