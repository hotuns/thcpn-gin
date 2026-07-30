-- name: CreateUser :one
INSERT INTO users (name, phone, email)
VALUES ($1, $2, $3)
RETURNING id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at, auth_version;

-- name: GetUser :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at, auth_version
FROM users
WHERE id = $1;

-- name: GetActiveUser :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at, auth_version
FROM users
WHERE id = $1 AND status = 'active';

-- name: FindActiveUserByEmail :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at, auth_version
FROM users
WHERE email = $1 AND status = 'active';

-- name: FindActiveUserByPhone :one
SELECT id, name, phone, email, status, created_at, updated_at, phone_verified_at, email_verified_at, last_login_at, auth_version
FROM users
WHERE phone = $1 AND status = 'active';
