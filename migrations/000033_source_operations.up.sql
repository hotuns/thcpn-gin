CREATE TABLE source_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id uuid NOT NULL REFERENCES data_sources(id),
    device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('sync_all', 'config_update')),
    status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed', 'unknown', 'reconciled')),
    request jsonb NOT NULL DEFAULT '{}',
    result jsonb NOT NULL DEFAULT '{}',
    error text NOT NULL DEFAULT '',
    actor_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX source_operations_source_created_idx ON source_operations(data_source_id, created_at DESC);
CREATE INDEX source_operations_device_created_idx ON source_operations(device_id, created_at DESC);
CREATE UNIQUE INDEX source_operations_active_sync_idx ON source_operations(data_source_id)
    WHERE kind='sync_all' AND status IN ('queued','running');
