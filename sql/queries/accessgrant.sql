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
    created_by
)
VALUES ($1, 'user', $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, workspace_id, subject_type, subject_id, role_id, scope_type, scope_id, expires_at, allow_reshare, allow_api_access, created_by, status, created_at, updated_at;

-- name: GetAccessGrant :one
SELECT
    ag.id,
    ag.workspace_id,
    ag.subject_type,
    ag.subject_id,
    ag.role_id,
    r.code AS role_code,
    r.name AS role_name,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
JOIN roles r ON r.id = ag.role_id
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
    r.code AS role_code,
    r.name AS role_name,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
JOIN roles r ON r.id = ag.role_id
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
    r.code AS role_code,
    r.name AS role_name,
    ag.scope_type,
    ag.scope_id,
    ag.expires_at,
    ag.allow_reshare,
    ag.allow_api_access,
    ag.created_by,
    ag.status,
    ag.created_at,
    ag.updated_at
FROM access_grants ag
JOIN roles r ON r.id = ag.role_id
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
RETURNING id, workspace_id, subject_type, subject_id, role_id, scope_type, scope_id, expires_at, allow_reshare, allow_api_access, created_by, status, created_at, updated_at;

-- name: HasAccessGrantPermission :one
SELECT EXISTS (
    SELECT 1
    FROM access_grants ag
    JOIN roles r ON r.id = ag.role_id
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ag.subject_type = 'user'
      AND ag.subject_id = $1
      AND ag.workspace_id = $2
      AND ag.status = 'active'
      AND (ag.expires_at IS NULL OR ag.expires_at > now())
      AND p.code = $3
      AND (r.workspace_id IS NULL OR r.workspace_id = ag.workspace_id)
      AND (
        ag.scope_type = 'workspace'
        OR (ag.scope_type = $4 AND ag.scope_id = $5)
        OR (ag.scope_type = 'project' AND sqlc.arg(project_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(project_id)::uuid)
        OR (ag.scope_type = 'site' AND sqlc.arg(site_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(site_id)::uuid)
        OR (ag.scope_type = 'device' AND sqlc.arg(device_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(device_id)::uuid)
        OR (ag.scope_type = 'dataset' AND sqlc.arg(dataset_id)::uuid IS NOT NULL AND ag.scope_id = sqlc.arg(dataset_id)::uuid)
      )
) AS allowed;

-- name: CreateInvitation :one
INSERT INTO invitations (
    workspace_id,
    invitee_email,
    invitee_phone,
    role_id,
    scope_type,
    scope_id,
    expires_at,
    invited_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at;

-- name: GetInvitation :one
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    r.code AS role_code,
    r.name AS role_name,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
JOIN roles r ON r.id = i.role_id
WHERE i.id = $1;

-- name: ListInvitationsByWorkspace :many
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    r.code AS role_code,
    r.name AS role_name,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
JOIN roles r ON r.id = i.role_id
WHERE i.workspace_id = $1
ORDER BY i.created_at DESC, i.id DESC;

-- name: ListPendingInvitationsForIdentity :many
SELECT
    i.id,
    i.workspace_id,
    i.invitee_email,
    i.invitee_phone,
    i.role_id,
    r.code AS role_code,
    r.name AS role_name,
    i.scope_type,
    i.scope_id,
    i.expires_at,
    i.invited_by,
    i.status,
    i.created_at,
    i.updated_at
FROM invitations i
JOIN roles r ON r.id = i.role_id
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
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at;

-- name: RevokeInvitation :one
UPDATE invitations
SET status = 'revoked',
    updated_at = now()
WHERE id = $1
  AND status = 'pending'
RETURNING id, workspace_id, invitee_email, invitee_phone, role_id, scope_type, scope_id, expires_at, invited_by, status, created_at, updated_at;
