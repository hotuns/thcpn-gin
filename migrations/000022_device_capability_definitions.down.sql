ALTER TABLE device_capabilities
    DROP CONSTRAINT IF EXISTS device_capabilities_capability_code_fkey;

DELETE FROM device_capabilities
WHERE capability_code NOT IN (
    'telemetry',
    'image_capture',
    'video_stream',
    'ptz_control',
    'remote_command',
    'configurable',
    'calibratable',
    'firmware_update',
    'edge_storage'
);

ALTER TABLE device_capabilities
    ADD CONSTRAINT device_capabilities_capability_code_check CHECK (
        capability_code IN (
            'telemetry',
            'image_capture',
            'video_stream',
            'ptz_control',
            'remote_command',
            'configurable',
            'calibratable',
            'firmware_update',
            'edge_storage'
        )
    );

DROP TABLE IF EXISTS device_capability_definitions;
