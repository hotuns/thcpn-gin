-- name: CreatePersonalWorkspace :one
INSERT INTO workspaces (type, name, owner_user_id)
VALUES ('personal', $1, $2)
RETURNING id, type, organization_type, name, owner_user_id, status, created_at, updated_at, is_demo_workspace;

-- name: CreateOrganizationWorkspace :one
INSERT INTO workspaces (type, organization_type, name, owner_user_id)
VALUES ('organization', $1, $2, $3)
RETURNING id, type, organization_type, name, owner_user_id, status, created_at, updated_at, is_demo_workspace;

-- name: GetWorkspace :one
SELECT id, type, organization_type, name, owner_user_id, status, created_at, updated_at, is_demo_workspace
FROM workspaces
WHERE id = $1;

-- name: CreateWorkspaceMember :one
INSERT INTO workspace_members (workspace_id, user_id, role_id, scope_type, scope_id, template_code)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at, scope_type, scope_id, template_code;

-- name: GetWorkspaceMember :one
SELECT id, workspace_id, user_id, role_id, status, joined_at, created_at, updated_at, scope_type, scope_id, template_code
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
    w.is_demo_workspace,
    wm.id AS membership_id,
    wm.status AS membership_status,
    wm.joined_at AS membership_joined_at,
    wm.scope_type AS membership_scope_type,
    wm.scope_id AS membership_scope_id,
    tr.id AS role_id,
    wm.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name
FROM workspace_members wm
JOIN workspaces w ON w.id = wm.workspace_id
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = wm.template_code
WHERE wm.user_id = $1
  AND wm.status = 'active'
  AND w.status = 'active'
  AND ((SELECT is_demo FROM users WHERE id = $1) = false OR w.is_demo_workspace = true)
ORDER BY w.created_at ASC;

-- name: ListWorkspaces :many
SELECT id, type, organization_type, name, owner_user_id, status, created_at, updated_at, is_demo_workspace
FROM workspaces
ORDER BY created_at DESC, id DESC;
