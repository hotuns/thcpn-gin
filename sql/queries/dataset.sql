-- name: CreateDataset :one
INSERT INTO datasets (
    workspace_id,
    project_id,
    name,
    description,
    data_type,
    time_start,
    time_end,
    created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at;

-- name: GetDataset :one
SELECT id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at
FROM datasets
WHERE id = $1;

-- name: ListDatasetsByWorkspace :many
SELECT id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at
FROM datasets
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListDatasetsByProject :many
SELECT id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at
FROM datasets
WHERE project_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateDataset :one
UPDATE datasets
SET name = $2,
    description = $3,
    data_type = $4,
    time_start = $5,
    time_end = $6,
    status = $7,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at;

-- name: DeleteDataset :one
DELETE FROM datasets
WHERE id = $1
RETURNING id, workspace_id, project_id, name, description, data_type, time_start, time_end, status, created_by, created_at, updated_at;

-- name: CreateDatasetSource :one
INSERT INTO dataset_sources (dataset_id, source_type, source_id)
VALUES ($1, $2, $3)
RETURNING id, dataset_id, source_type, source_id, created_at;

-- name: ListDatasetSources :many
SELECT id, dataset_id, source_type, source_id, created_at
FROM dataset_sources
WHERE dataset_id = $1
ORDER BY created_at ASC, id ASC;

-- name: DeleteDatasetSources :exec
DELETE FROM dataset_sources
WHERE dataset_id = $1;
