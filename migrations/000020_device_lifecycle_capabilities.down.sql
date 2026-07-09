DROP TABLE IF EXISTS device_lifecycle_events;

ALTER TABLE devices
    DROP COLUMN IF EXISTS lifecycle_updated_at,
    DROP COLUMN IF EXISTS lifecycle_status;
