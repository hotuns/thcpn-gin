CREATE TABLE datasets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    project_id uuid,
    name text NOT NULL,
    description text,
    data_type text NOT NULL CHECK (data_type IN ('telemetry', 'image', 'video', 'audio', 'event', 'log', 'mixed')),
    time_start timestamptz NOT NULL,
    time_end timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked', 'archived', 'published')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    CHECK (time_end > time_start),
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id)
);

CREATE INDEX datasets_workspace_created_idx
    ON datasets (workspace_id, created_at DESC);

CREATE INDEX datasets_project_created_idx
    ON datasets (project_id, created_at DESC)
    WHERE project_id IS NOT NULL;

CREATE TABLE dataset_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
    source_type text NOT NULL CHECK (source_type IN ('device', 'data_stream', 'file')),
    source_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (dataset_id, source_type, source_id)
);

CREATE INDEX dataset_sources_dataset_idx
    ON dataset_sources (dataset_id);
