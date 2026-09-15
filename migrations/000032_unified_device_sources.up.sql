DO $$
DECLARE conflicting_devices text;
BEGIN
    SELECT string_agg(device_id::text, ', ' ORDER BY device_id::text)
    INTO conflicting_devices
    FROM (
        SELECT device_id
        FROM (
            SELECT device_id FROM device_source_refs WHERE status = 'active'
            UNION ALL
            SELECT device_id FROM lorawan_v2_device_refs WHERE status = 'active'
        ) refs
        GROUP BY device_id HAVING count(*) > 1
    ) conflicts;
    IF conflicting_devices IS NOT NULL THEN
        RAISE EXCEPTION 'Multiple active management sources for devices: %', conflicting_devices;
    END IF;
END $$;

ALTER TABLE device_source_refs DROP CONSTRAINT device_source_refs_external_device_id_check;
ALTER TABLE device_source_refs RENAME COLUMN external_device_id TO external_key;
ALTER TABLE device_source_refs ALTER COLUMN external_key TYPE text USING external_key::text;
ALTER TABLE device_source_refs DROP CONSTRAINT device_source_refs_adapter_code_check;
ALTER TABLE device_source_refs ADD CONSTRAINT device_source_refs_adapter_code_check
    CHECK (adapter_code IN ('thcpn_legacy_mysql', 'thcpn_legacy_camera', 'carbon_sink_mysql', 'lorawan_v2'));
ALTER TABLE device_source_refs ADD CONSTRAINT device_source_refs_external_key_check CHECK (
    CASE WHEN adapter_code = 'lorawan_v2' THEN length(btrim(external_key)) > 0
    ELSE external_key ~ '^[1-9][0-9]*$' AND external_key::numeric <= 9223372036854775807 END
);

INSERT INTO device_source_refs (id, device_id, data_source_id, adapter_code, external_key, status, synced_at, created_at, updated_at)
SELECT id, device_id, data_source_id, 'lorawan_v2', gateway_sn, status, synced_at, created_at, updated_at
FROM lorawan_v2_device_refs;

CREATE UNIQUE INDEX device_source_refs_active_device_key ON device_source_refs (device_id) WHERE status = 'active';
DROP TABLE lorawan_v2_device_refs;
