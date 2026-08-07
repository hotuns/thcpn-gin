CREATE TABLE processing_processors (
    code varchar(64) NOT NULL,
    version varchar(32) NOT NULL,
    name varchar(128) NOT NULL,
    description text NOT NULL DEFAULT '',
    manifest_json jsonb NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (code, version)
);

INSERT INTO device_capability_definitions (code, name, sort_order)
VALUES ('ndvi_processing', 'NDVI 数据处理', 100)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE processing_tasks (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name varchar(128) NOT NULL,
    description text NOT NULL DEFAULT '',
    target_type varchar(16) NOT NULL CHECK (target_type IN ('device', 'site')),
    target_id uuid NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
    current_version integer NOT NULL DEFAULT 1,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX processing_tasks_workspace_idx ON processing_tasks(workspace_id, status, created_at DESC);

CREATE TABLE processing_task_versions (
    task_id uuid NOT NULL REFERENCES processing_tasks(id) ON DELETE CASCADE,
    version integer NOT NULL,
    processor_code varchar(64) NOT NULL,
    processor_version varchar(32) NOT NULL,
    processor_manifest_json jsonb NOT NULL,
    config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    trigger_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    start_at timestamptz NOT NULL,
    effective_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (task_id, version),
    FOREIGN KEY (processor_code, processor_version) REFERENCES processing_processors(code, version)
);

CREATE TABLE processing_task_inputs (
    task_id uuid NOT NULL,
    task_version integer NOT NULL,
    slot_code varchar(64) NOT NULL,
    source_type varchar(24) NOT NULL CHECK (source_type IN ('data_stream', 'processing_task', 'metadata')),
    source_id uuid,
    source_task_id uuid REFERENCES processing_tasks(id),
    config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (task_id, task_version, slot_code),
    FOREIGN KEY (task_id, task_version) REFERENCES processing_task_versions(task_id, version) ON DELETE CASCADE
);

CREATE INDEX processing_task_inputs_upstream_idx ON processing_task_inputs(source_task_id) WHERE source_task_id IS NOT NULL;

CREATE TABLE processing_executions (
    id uuid PRIMARY KEY,
    task_id uuid NOT NULL,
    task_version integer NOT NULL,
    input_key varchar(255) NOT NULL,
    status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'submitted', 'running', 'success', 'failed', 'superseded')),
    attempt integer NOT NULL DEFAULT 0,
    external_execution_id varchar(128),
    window_start timestamptz,
    window_end timestamptz,
    observed_at timestamptz,
    request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_message text NOT NULL DEFAULT '',
    supersedes_id uuid REFERENCES processing_executions(id),
    queued_at timestamptz,
    started_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (task_id, task_version) REFERENCES processing_task_versions(task_id, version),
    UNIQUE (task_id, task_version, input_key)
);

CREATE INDEX processing_executions_task_idx ON processing_executions(task_id, created_at DESC);
CREATE INDEX processing_executions_status_idx ON processing_executions(status, created_at);

CREATE TABLE processing_results (
    id uuid PRIMARY KEY,
    execution_id uuid NOT NULL REFERENCES processing_executions(id) ON DELETE CASCADE,
    output_code varchar(64) NOT NULL,
    kind varchar(16) NOT NULL CHECK (kind IN ('metric', 'record', 'artifact')),
    observed_at timestamptz,
    numeric_value double precision,
    unit varchar(32),
    record_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    object_key varchar(1024),
    content_type varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (execution_id, output_code)
);

INSERT INTO permissions (code, name, resource_type, action)
VALUES
    ('processing.view', '查看数据处理', 'processing', 'view'),
    ('processing.manage', '管理数据处理', 'processing', 'manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'processing.view'
WHERE roles.workspace_id IS NULL
  AND roles.code IN ('owner', 'admin', 'project_manager', 'site_operator', 'data_manager', 'researcher', 'viewer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.code = 'processing.manage'
WHERE roles.workspace_id IS NULL
  AND roles.code IN ('owner', 'admin', 'project_manager', 'data_manager', 'researcher')
ON CONFLICT DO NOTHING;
