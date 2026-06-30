-- name: CreateUser :one
INSERT INTO users (name, phone, email)
VALUES ($1, $2, $3)
RETURNING id, name, phone, email, status, created_at, updated_at;

-- name: GetUser :one
SELECT id, name, phone, email, status, created_at, updated_at
FROM users
WHERE id = $1;

-- name: GetActiveUser :one
SELECT id, name, phone, email, status, created_at, updated_at
FROM users
WHERE id = $1 AND status = 'active';
