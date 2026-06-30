-- name: CreateUserCredential :one
INSERT INTO user_credentials (user_id, password_hash)
VALUES ($1, $2)
RETURNING user_id, password_hash, password_updated_at, failed_attempts, locked_until, created_at, updated_at;

-- name: GetUserCredential :one
SELECT user_id, password_hash, password_updated_at, failed_attempts, locked_until, created_at, updated_at
FROM user_credentials
WHERE user_id = $1;

-- name: UpdateUserCredentialFailure :one
UPDATE user_credentials
SET failed_attempts = $2,
    locked_until = $3,
    updated_at = now()
WHERE user_id = $1
RETURNING user_id, password_hash, password_updated_at, failed_attempts, locked_until, created_at, updated_at;

-- name: ResetUserCredentialFailure :one
UPDATE user_credentials
SET failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE user_id = $1
RETURNING user_id, password_hash, password_updated_at, failed_attempts, locked_until, created_at, updated_at;

-- name: FindActiveUserByIdentifier :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at
FROM users
WHERE status = 'active'
  AND (phone = sqlc.arg(identifier) OR email = sqlc.arg(identifier));

-- name: FindActiveUserByPhoneForAuth :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at
FROM users
WHERE status = 'active'
  AND phone = sqlc.arg(phone);

-- name: UpdateUserLastLogin :one
UPDATE users
SET last_login_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at;

-- name: UpdateUserPhoneVerifiedAndLogin :one
UPDATE users
SET phone_verified_at = COALESCE(phone_verified_at, now()),
    last_login_at = now(),
    updated_at = now()
WHERE id = $1
RETURNING id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at;

-- name: CreateRefreshSession :one
INSERT INTO auth_refresh_sessions (user_id, refresh_token_hash, user_agent, client_ip, expires_at)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, user_id, refresh_token_hash, user_agent, client_ip, expires_at, last_used_at, revoked_at, created_at, updated_at;

-- name: GetActiveRefreshSessionByHash :one
SELECT id, user_id, refresh_token_hash, user_agent, client_ip, expires_at, last_used_at, revoked_at, created_at, updated_at
FROM auth_refresh_sessions
WHERE refresh_token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > now();

-- name: RotateRefreshSession :one
UPDATE auth_refresh_sessions
SET refresh_token_hash = $2,
    user_agent = $3,
    client_ip = $4,
    expires_at = $5,
    last_used_at = now(),
    updated_at = now()
WHERE id = $1
  AND revoked_at IS NULL
RETURNING id, user_id, refresh_token_hash, user_agent, client_ip, expires_at, last_used_at, revoked_at, created_at, updated_at;

-- name: ListActiveRefreshSessionsByUser :many
SELECT id, user_id, refresh_token_hash, user_agent, client_ip, expires_at, last_used_at, revoked_at, created_at, updated_at
FROM auth_refresh_sessions
WHERE user_id = $1
  AND revoked_at IS NULL
  AND expires_at > now()
ORDER BY last_used_at DESC NULLS LAST, created_at DESC;

-- name: RevokeRefreshSession :exec
UPDATE auth_refresh_sessions
SET revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE id = $1;

-- name: RevokeRefreshSessionForUser :execrows
UPDATE auth_refresh_sessions
SET revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE id = $1
  AND user_id = $2
  AND revoked_at IS NULL;

-- name: RevokeRefreshSessionByHash :exec
UPDATE auth_refresh_sessions
SET revoked_at = COALESCE(revoked_at, now()),
    updated_at = now()
WHERE refresh_token_hash = $1;

-- name: BlacklistAccessToken :exec
INSERT INTO auth_access_token_blacklist (token_hash, user_id, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (token_hash) DO NOTHING;

-- name: IsAccessTokenBlacklisted :one
SELECT EXISTS (
    SELECT 1
    FROM auth_access_token_blacklist
    WHERE token_hash = $1
      AND expires_at > now()
);

-- name: DeleteExpiredAuthTokens :exec
DELETE FROM auth_access_token_blacklist
WHERE expires_at <= now();
