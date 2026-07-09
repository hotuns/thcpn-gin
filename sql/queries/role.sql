-- name: GetSystemRoleByCode :one
SELECT id, workspace_id, code, name, is_system_role, created_at, updated_at
FROM roles
WHERE workspace_id IS NULL AND code = $1 AND is_system_role = true;

-- name: ListSystemRoles :many
SELECT id, workspace_id, code, name, is_system_role, created_at, updated_at
FROM roles
WHERE workspace_id IS NULL AND is_system_role = true
ORDER BY code;

-- name: ListPermissions :many
SELECT id, code, name, resource_type, action
FROM permissions
ORDER BY resource_type, action, code;

-- name: ListSystemRolePermissionTemplates :many
SELECT
    r.id,
    r.code,
    r.name,
    ARRAY(
        SELECT p.code
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = r.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes
FROM roles r
WHERE r.workspace_id IS NULL
  AND r.is_system_role = true
ORDER BY r.code;

-- name: CountPermissionsByCodes :one
SELECT count(*)::bigint
FROM permissions
WHERE code = ANY($1::text[]);

-- name: ListPermissionCodesByTemplate :many
SELECT p.code
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.workspace_id IS NULL
  AND r.is_system_role = true
  AND r.code = $1
ORDER BY p.resource_type, p.action, p.code;

-- name: UpdateSystemRoleName :one
UPDATE roles
SET name = $2,
    updated_at = now()
WHERE workspace_id IS NULL
  AND code = $1
  AND is_system_role = true
RETURNING id, workspace_id, code, name, is_system_role, created_at, updated_at;
