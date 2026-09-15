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
INSERT INTO lorawan_v2_device_refs (id, device_id, data_source_id, gateway_sn, status, synced_at, created_at, updated_at)
SELECT id, device_id, data_source_id, external_key, CASE WHEN status = 'active' THEN 'active' ELSE 'disabled' END, synced_at, created_at, updated_at
FROM device_source_refs WHERE adapter_code = 'lorawan_v2';
DELETE FROM device_source_refs WHERE adapter_code = 'lorawan_v2';
DROP INDEX device_source_refs_active_device_key;
ALTER TABLE device_source_refs DROP CONSTRAINT device_source_refs_external_key_check;
ALTER TABLE device_source_refs DROP CONSTRAINT device_source_refs_adapter_code_check;
ALTER TABLE device_source_refs ADD CONSTRAINT device_source_refs_adapter_code_check
    CHECK (adapter_code IN ('thcpn_legacy_mysql', 'thcpn_legacy_camera', 'carbon_sink_mysql'));
ALTER TABLE device_source_refs ALTER COLUMN external_key TYPE bigint USING external_key::bigint;
ALTER TABLE device_source_refs RENAME COLUMN external_key TO external_device_id;
ALTER TABLE device_source_refs ADD CONSTRAINT device_source_refs_external_device_id_check CHECK (external_device_id > 0);
