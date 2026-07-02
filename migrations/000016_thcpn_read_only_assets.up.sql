CREATE TABLE device_source_refs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    device_id uuid NOT NULL,
    data_source_id uuid NOT NULL REFERENCES data_sources (id),
    adapter_code text NOT NULL CHECK (adapter_code IN ('thcpn_legacy_mysql')),
    external_device_id bigint NOT NULL CHECK (external_device_id > 0),
    external_sn text,
    external_uuid text,
    external_device_type text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, data_source_id, adapter_code),
    UNIQUE (data_source_id, adapter_code, external_device_id),
    FOREIGN KEY (device_id, workspace_id) REFERENCES devices (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX device_source_refs_workspace_status_idx
    ON device_source_refs (workspace_id, status, synced_at DESC);

CREATE INDEX device_source_refs_device_idx
    ON device_source_refs (device_id, status);

CREATE TABLE device_config_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    data_source_id uuid NOT NULL REFERENCES data_sources (id),
    adapter_code text NOT NULL CHECK (adapter_code IN ('thcpn_legacy_mysql')),
    external_device_id bigint NOT NULL CHECK (external_device_id > 0),
    external_config_id bigint NOT NULL CHECK (external_config_id > 0),
    version text,
    data_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    image_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    control_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_created_at timestamptz,
    source_updated_at timestamptz,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, adapter_code, external_config_id)
);

CREATE INDEX device_config_snapshots_device_idx
    ON device_config_snapshots (device_id, synced_at DESC);

CREATE INDEX device_config_snapshots_external_device_idx
    ON device_config_snapshots (data_source_id, adapter_code, external_device_id, synced_at DESC);
