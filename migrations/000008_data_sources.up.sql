CREATE TABLE data_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('postgres', 'mysql', 'clickhouse', 'http_api', 'file')),
    dsn_secret_ref text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX data_sources_workspace_name_unique
    ON data_sources (workspace_id, lower(name));

CREATE INDEX data_sources_workspace_status_idx
    ON data_sources (workspace_id, status, created_at DESC);

CREATE TABLE data_stream_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    data_stream_id uuid NOT NULL REFERENCES data_streams (id) ON DELETE CASCADE,
    data_source_id uuid NOT NULL REFERENCES data_sources (id),
    database_name text,
    schema_name text,
    table_name text NOT NULL,
    device_key_field text NOT NULL,
    device_key_value text NOT NULL,
    time_field text NOT NULL,
    value_field text NOT NULL,
    payload_type text NOT NULL CHECK (payload_type IN ('columns', 'json', 'media')),
    query_config_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (data_stream_id, data_source_id, table_name, device_key_field, device_key_value, time_field, value_field)
);

CREATE INDEX data_stream_bindings_stream_status_idx
    ON data_stream_bindings (data_stream_id, status, created_at DESC);
