DROP TABLE IF EXISTS camera_bindings;

UPDATE devices
SET device_type = 'standalone',
    updated_at = now()
WHERE device_type = 'camera';

ALTER TABLE devices
    DROP CONSTRAINT IF EXISTS devices_device_type_check,
    ADD CONSTRAINT devices_device_type_check
        CHECK (device_type IN ('standalone', 'gateway', 'gateway_node'));
