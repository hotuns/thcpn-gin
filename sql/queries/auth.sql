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
