CREATE TABLE device_operations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    operation_type text NOT NULL CHECK (operation_type IN ('calibration', 'firmware_upgrade')),
    status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'success', 'failed', 'cancelled')),
    request_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    requested_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_operations_device_created_at_idx
    ON device_operations (device_id, created_at DESC);

CREATE INDEX device_operations_workspace_created_at_idx
    ON device_operations (workspace_id, created_at DESC);
