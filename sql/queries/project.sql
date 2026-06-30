-- name: CreateProject :one
INSERT INTO projects (workspace_id, name, description, created_by)
VALUES ($1, $2, $3, $4)
RETURNING id, workspace_id, name, description, status, created_by, created_at, updated_at;

-- name: GetProject :one
SELECT id, workspace_id, name, description, status, created_by, created_at, updated_at
FROM projects
WHERE id = $1;

-- name: ListProjectsByWorkspace :many
SELECT id, workspace_id, name, description, status, created_by, created_at, updated_at
FROM projects
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateProject :one
UPDATE projects
SET name = $2,
    description = $3,
    status = $4,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, name, description, status, created_by, created_at, updated_at;
