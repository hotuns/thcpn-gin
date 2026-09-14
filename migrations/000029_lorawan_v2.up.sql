CREATE TABLE lorawan_v2_device_refs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    data_source_id uuid NOT NULL REFERENCES data_sources(id) ON DELETE RESTRICT,
    gateway_sn text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, gateway_sn),
    UNIQUE (device_id, data_source_id)
);

CREATE INDEX lorawan_v2_device_refs_device_id_idx ON lorawan_v2_device_refs (device_id);
