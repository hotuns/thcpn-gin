-- name: CreateExportJob :one
INSERT INTO export_jobs (
    workspace_id,
    requested_by,
    resource_type,
    resource_id,
    export_type,
    expires_at
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at;

-- name: GetExportJob :one
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at
FROM export_jobs
WHERE id = $1;

-- name: ListExportJobsByWorkspace :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at
FROM export_jobs
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;

-- name: ListExportJobsByRequester :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at
FROM export_jobs
WHERE requested_by = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;

-- name: MarkExportJobRunning :one
UPDATE export_jobs
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = $1
  AND status = 'pending'
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at;

-- name: MarkExportJobSuccess :one
UPDATE export_jobs
SET status = 'success',
    file_object_key = $2,
    error_message = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND status IN ('pending', 'running')
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at;

-- name: MarkExportJobFailed :one
UPDATE export_jobs
SET status = 'failed',
    error_message = $2,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND status IN ('pending', 'running')
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at;
