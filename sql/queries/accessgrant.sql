-- name: CreateAccessGrant :one
INSERT INTO access_grants (
    workspace_id,
    subject_type,
    subject_id,
    role_id,
    scope_type,
    scope_id,
    expires_at,
    allow_reshare,
    allow_api_access,
    created_by,
    template_code,
    parent_grant_id
)
VALUES ($1, 'user', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, workspace_id, subject_type, subject_id, role_id, scope_type, scope_id, expires_at, allow_reshare, allow_api_access, created_by, status, created_at, updated_at, template_code, parent_grant_id;

-- name: GetAccessGrant :one
SELECT
    ag.id,
    ag.workspace_id,
    ag.subject_type,
    ag.subject_id,
    ag.role_id,
    ag.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    ag.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM access_grant_permissions agp
        JOIN permissions p ON p.id = agp.permission_id
        WHERE agp.access_grant_id = ag.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.parent_grant_id,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = ag.template_code
WHERE ag.id = $1;

-- name: ListAccessGrantsByWorkspace :many
SELECT
    ag.id,
    ag.workspace_id,
    ag.subject_type,
    ag.subject_id,
    u.name AS subject_name,
    u.phone AS subject_phone,
    u.email AS subject_email,
    ag.role_id,
    ag.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    ag.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM access_grant_permissions agp
        JOIN permissions p ON p.id = agp.permission_id
        WHERE agp.access_grant_id = ag.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.parent_grant_id,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = ag.template_code
JOIN users u ON u.id = ag.subject_id
WHERE ag.workspace_id = $1
ORDER BY ag.created_at DESC, ag.id DESC;

-- name: ListAccessGrantsForUser :many
SELECT
    ag.id,
    ag.workspace_id,
    ag.subject_type,
    ag.subject_id,
    w.name AS workspace_name,
    ag.role_id,
    ag.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    ag.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM access_grant_permissions agp
        JOIN permissions p ON p.id = agp.permission_id
        WHERE agp.access_grant_id = ag.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.parent_grant_id,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = ag.template_code
JOIN workspaces w ON w.id = ag.workspace_id
WHERE ag.subject_type = 'user'
  AND ag.subject_id = $1
  AND ag.status = 'active'
  AND (ag.expires_at IS NULL OR ag.expires_at > now())
ORDER BY ag.created_at DESC, ag.id DESC;

-- name: RevokeAccessGrant :one
UPDATE access_grants
SET status = 'revoked',
    updated_at = now()
WHERE id = $1
  AND status = 'active'
RETURNING id, workspace_id, subject_type, subject_id, role_id, scope_type, scope_id, expires_at, allow_reshare, allow_api_access, created_by, status, created_at, updated_at, template_code, parent_grant_id;

-- name: CascadeInactiveAccessGrants :execrows
WITH RECURSIVE inactive AS (
    SELECT child.id
    FROM access_grants child
    JOIN access_grants parent ON parent.id = child.parent_grant_id
    WHERE child.status = 'active'
      AND (parent.status <> 'active' OR (parent.expires_at IS NOT NULL AND parent.expires_at <= now()))
    UNION
    SELECT child.id
    FROM access_grants child
    JOIN inactive parent ON parent.id = child.parent_grant_id
    WHERE child.status = 'active'
)
UPDATE access_grants
SET status = 'revoked', updated_at = now()
WHERE id IN (SELECT id FROM inactive);

-- name: ExpireAccessGrants :execrows
UPDATE access_grants
SET status = 'expired',
    updated_at = now()
WHERE status = 'active'
  AND expires_at IS NOT NULL
  AND expires_at <= now();

-- name: GetAccessGrantPermissionRole :one
SELECT ag.template_code
FROM access_grants ag
JOIN access_grant_permissions agp ON agp.access_grant_id = ag.id
JOIN permissions p ON p.id = agp.permission_id
WHERE ag.subject_type = 'user'
  AND ag.subject_id = $1
  AND ag.workspace_id = $2
  AND ag.status = 'active'
  AND (ag.expires_at IS NULL OR ag.expires_at > now())
  AND (
    ag.parent_grant_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM access_grants parent
      WHERE parent.id = ag.parent_grant_id
        AND parent.status = 'active'
        AND (parent.expires_at IS NULL OR parent.expires_at > now())
    )
  )
  AND p.code = $3
  AND (
    ag.scope_type = 'workspace'
    OR (ag.scope_type = $4 AND ag.scope_id = $5)
    OR (ag.scope_type = 'project' AND sqlc.arg(project_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(project_id)::uuid)
    OR (ag.scope_type = 'site' AND sqlc.arg(site_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(site_id)::uuid)
    OR (ag.scope_type = 'device' AND sqlc.arg(device_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(device_id)::uuid)
    OR (ag.scope_type = 'dataset' AND sqlc.arg(dataset_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(dataset_id)::uuid)
  )
ORDER BY
  CASE WHEN ag.template_code = 'service_engineer' THEN 0 ELSE 1 END,
  ag.created_at DESC,
  ag.id DESC
LIMIT 1;

-- name: CreateInvitation :one
INSERT INTO invitations (
    workspace_id,
    invitee_email,
    invitee_phone,
    role_id,
    scope_type,
    scope_id,
    expires_at,
    invited_by,
    template_code,
    parent_grant_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at, template_code, parent_grant_id;

-- name: GetInvitation :one
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    i.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    i.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM invitation_permissions ip
        JOIN permissions p ON p.id = ip.permission_id
        WHERE ip.invitation_id = i.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.parent_grant_id,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = i.template_code
WHERE i.id = $1;

-- name: ListInvitationsByWorkspace :many
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    i.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    i.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM invitation_permissions ip
        JOIN permissions p ON p.id = ip.permission_id
        WHERE ip.invitation_id = i.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.parent_grant_id,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = i.template_code
WHERE i.workspace_id = $1
ORDER BY i.created_at DESC, i.id DESC;

-- name: ListPendingInvitationsForIdentity :many
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    i.template_code AS role_code,
    COALESCE(tr.name, '自定义权限') AS role_name,
    i.template_code,
    COALESCE(tr.name, '自定义权限') AS template_name,
    ARRAY(
        SELECT p.code
        FROM invitation_permissions ip
        JOIN permissions p ON p.id = ip.permission_id
        WHERE ip.invitation_id = i.id
        ORDER BY p.resource_type, p.action, p.code
    )::text[] AS permission_codes,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.parent_grant_id,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
LEFT JOIN roles tr ON tr.workspace_id IS NULL AND tr.code = i.template_code
WHERE i.status = 'pending'
  AND (i.expires_at IS NULL OR i.expires_at > now())
  AND (
    (sqlc.arg(invitee_email)::text IS NOT NULL AND i.invitee_email = sqlc.arg(invitee_email)::text)
    OR
    (sqlc.arg(invitee_phone)::text IS NOT NULL AND i.invitee_phone = sqlc.arg(invitee_phone)::text)
  )
ORDER BY i.created_at DESC, i.id DESC;

-- name: AcceptInvitation :one
UPDATE invitations
SET status = 'accepted',
    updated_at = now()
WHERE id = $1
  AND status = 'pending'
  AND (expires_at IS NULL OR expires_at > now())
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at, template_code, parent_grant_id;

-- name: RevokeInvitation :one
UPDATE invitations
SET status = 'revoked',
    updated_at = now()
WHERE id = $1
  AND status = 'pending'
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at, template_code, parent_grant_id;

-- name: ExpireInvitations :execrows
UPDATE invitations
SET status = 'expired',
    updated_at = now()
WHERE status = 'pending'
  AND expires_at IS NOT NULL
  AND expires_at <= now();

-- name: DeleteAccessGrantPermissions :exec
DELETE FROM access_grant_permissions
WHERE access_grant_id = $1;

-- name: AddAccessGrantPermissions :execrows
INSERT INTO access_grant_permissions (access_grant_id, permission_id)
SELECT $1, p.id
FROM permissions p
WHERE p.code = ANY($2::text[])
ON CONFLICT DO NOTHING;

-- name: DeleteInvitationPermissions :exec
DELETE FROM invitation_permissions
WHERE invitation_id = $1;

-- name: AddInvitationPermissions :execrows
INSERT INTO invitation_permissions (invitation_id, permission_id)
SELECT $1, p.id
FROM permissions p
WHERE p.code = ANY($2::text[])
ON CONFLICT DO NOTHING;

-- name: CopyInvitationPermissionsToAccessGrant :execrows
INSERT INTO access_grant_permissions (access_grant_id, permission_id)
SELECT $2, ip.permission_id
FROM invitation_permissions ip
WHERE ip.invitation_id = $1
ON CONFLICT DO NOTHING;
