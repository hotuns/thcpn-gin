-- name: CreatePersonalWorkspace :one
INSERT INTO workspaces (type, name, owner_user_id)
VALUES ('personal', $1, $2)
RETURNING id, type, organization_type, name, owner_user_id, status, created_at, updated_at;

-- name: CreateOrganizationWorkspace :one
INSERT INTO workspaces (type, organization_type, name, owner_user_id)
VALUES ('organization', $1, $2, $3)
RETURNING id, type, organization_type, name, owner_user_id, status, created_at, updated_at;

-- name: GetWorkspace :one
SELECT id, type, organization_type, name, owner_user_id, status, created_at, updated_at
FROM workspaces
WHERE id = $1;

-- name: CreateWorkspaceMember :one
INSERT INTO workspace_members (workspace_id, user_id, role_id)
VALUES ($1, $2, $3)
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at;

-- name: GetWorkspaceMember :one
SELECT id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at
FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2;

-- name: ListWorkspacesForUser :many
SELECT
    w.id,
    w.type,
    w.organization_type,
    w.name,
    w.owner_user_id,
    w.status,
    w.created_at,
    w.updated_at,
    wm.id AS membership_id,
    wm.status AS membership_status,
    wm.joined_at AS membership_joined_at,
    r.id AS role_id,
    r.code AS role_code,
    r.name AS role_name
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
JOIN roles r ON r.id = wm.role_id
WHERE wm.user_id = $1
  AND wm.status = 'active'
  AND w.status = 'active'
ORDER BY w.created_at ASC;
