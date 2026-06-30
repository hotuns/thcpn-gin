-- name: CreateExportJob :one
INSERT INTO export_jobs (
    workspace_id,
    requested_by,
    resource_type,
    resource_id,
    export_type,
    request_config_json,
    expires_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;

-- name: GetExportJob :one
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json
FROM export_jobs
WHERE id = $1;

-- name: ListExportJobsByWorkspace :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json
FROM export_jobs
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;

-- name: ListExportJobsByRequester :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json
FROM export_jobs
WHERE requested_by = $1
ORDER BY created_at DESC, id DESC
LIMIT $2;

-- name: ListExportJobsByRequesterAndWorkspace :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json
FROM export_jobs
WHERE workspace_id = $1
  AND requested_by = $2
ORDER BY created_at DESC, id DESC
LIMIT $3;

-- name: ClaimNextPendingExportJob :one
WITH next_job AS (
    SELECT id
    FROM export_jobs
    WHERE status = 'pending'
      AND expires_at > now()
    ORDER BY created_at ASC, id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE export_jobs
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id IN (SELECT id FROM next_job)
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;

-- name: ExpireExportJobs :execrows
UPDATE export_jobs
SET status = 'expired',
    updated_at = now(),
    finished_at = COALESCE(finished_at, now())
WHERE status IN ('pending', 'running')
  AND expires_at <= now();

-- name: ListExpiredExportFiles :many
SELECT id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json
FROM export_jobs
WHERE status = 'success'
  AND expires_at <= now()
  AND file_object_key IS NOT NULL
ORDER BY expires_at ASC, id ASC
LIMIT $1;

-- name: MarkExportJobExpired :one
UPDATE export_jobs
SET status = 'expired',
    file_object_key = NULL,
    updated_at = now(),
    finished_at = COALESCE(finished_at, now())
WHERE id = $1
  AND status = 'success'
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;

-- name: MarkExportJobRunning :one
UPDATE export_jobs
SET status = 'running',
    started_at = COALESCE(started_at, now()),
    updated_at = now()
WHERE id = $1
  AND status = 'pending'
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;

-- name: MarkExportJobSuccess :one
UPDATE export_jobs
SET status = 'success',
    file_object_key = $2,
    error_message = NULL,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND status IN ('pending', 'running')
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;

-- name: MarkExportJobFailed :one
UPDATE export_jobs
SET status = 'failed',
    error_message = $2,
    finished_at = now(),
    updated_at = now()
WHERE id = $1
  AND status IN ('pending', 'running')
RETURNING id, workspace_id, requested_by, resource_type, resource_id, export_type, status, file_object_key, error_message, created_at, updated_at, started_at, finished_at, expires_at, request_config_json;
