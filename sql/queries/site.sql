-- name: CreateSite :one
INSERT INTO sites (
    workspace_id,
    project_id,
    name,
    description,
    location_text,
    latitude,
    longitude,
    ecosystem_term_id,
    altitude_m,
    created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m;

-- name: GetSite :one
SELECT id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m
FROM sites
WHERE id = $1;

-- name: GetSiteForUpdate :one
SELECT id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m
FROM sites
WHERE id = $1 FOR UPDATE;

-- name: ListSitesByWorkspace :many
SELECT id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m
FROM sites
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListSitesByProject :many
SELECT id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m
FROM sites
WHERE project_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateSite :one
UPDATE sites
SET name = $2,
    description = $3,
    location_text = $4,
    latitude = $5,
    longitude = $6,
    ecosystem_term_id = $7,
    altitude_m = $8,
    status = $9,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, project_id, name, description, location_text, latitude, longitude, status, created_by, created_at, updated_at, ecosystem_term_id, altitude_m;
