-- name: GetSystemRoleByCode :one
SELECT id, workspace_id, code, name, is_system_role, created_at, updated_at
FROM roles
WHERE workspace_id IS NULL AND code = $1 AND is_system_role = true;

-- name: ListSystemRoles :many
SELECT id, workspace_id, code, name, is_system_role, created_at, updated_at
FROM roles
WHERE workspace_id IS NULL AND is_system_role = true
ORDER BY code;
