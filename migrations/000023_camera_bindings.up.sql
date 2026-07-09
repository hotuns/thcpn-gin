ALTER TABLE devices
    DROP CONSTRAINT IF EXISTS devices_device_type_check,
    ADD CONSTRAINT devices_device_type_check
        CHECK (device_type IN ('standalone', 'gateway', 'gateway_node', 'camera'));

CREATE TABLE camera_bindings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    provider text NOT NULL DEFAULT 'ezviz' CHECK (provider IN ('ezviz')),
    device_serial text NOT NULL,
    channel_no integer NOT NULL DEFAULT 1 CHECK (channel_no > 0),
    default_quality text NOT NULL DEFAULT 'hd' CHECK (default_quality IN ('fluent', 'standard', 'hd', 'ultra_hd')),
    is_encrypted boolean NOT NULL DEFAULT false,
    validate_code_secret_ref text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id),
    UNIQUE (provider, device_serial, channel_no)
);

CREATE INDEX camera_bindings_status_idx
    ON camera_bindings (status, created_at DESC);
