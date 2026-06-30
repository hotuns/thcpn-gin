CREATE TABLE export_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    requested_by uuid NOT NULL REFERENCES users (id),
    resource_type text NOT NULL CHECK (resource_type IN ('device', 'data_stream', 'dataset', 'media')),
    resource_id uuid NOT NULL,
    export_type text NOT NULL CHECK (export_type IN ('telemetry_csv', 'telemetry_excel', 'media_zip', 'dataset_zip')),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed', 'expired')),
    file_object_key text,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    expires_at timestamptz NOT NULL,
    CHECK (
        (status = 'success' AND file_object_key IS NOT NULL)
        OR
        (status <> 'success')
    )
);

CREATE INDEX export_jobs_workspace_created_idx
    ON export_jobs (workspace_id, created_at DESC);

CREATE INDEX export_jobs_requested_by_created_idx
    ON export_jobs (requested_by, created_at DESC);

CREATE INDEX export_jobs_status_created_idx
    ON export_jobs (status, created_at ASC);
