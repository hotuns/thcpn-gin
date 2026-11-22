ALTER TABLE device_inspection_events
    ADD COLUMN severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'critical'));
