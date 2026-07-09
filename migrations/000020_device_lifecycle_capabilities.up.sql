ALTER TABLE devices
    ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'inbound' CHECK (
        lifecycle_status IN ('inbound', 'installed', 'online', 'maintenance', 'repairing', 'retired')
    ),
    ADD COLUMN lifecycle_updated_at timestamptz;

UPDATE devices
SET lifecycle_status = CASE status
        WHEN 'active' THEN 'online'
        WHEN 'disabled' THEN 'maintenance'
        WHEN 'retired' THEN 'retired'
        ELSE 'inbound'
    END,
    lifecycle_updated_at = COALESCE(activated_at, updated_at, created_at, now());

CREATE TABLE device_lifecycle_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    from_status text CHECK (
        from_status IN ('inbound', 'installed', 'online', 'maintenance', 'repairing', 'retired')
    ),
    to_status text NOT NULL CHECK (
        to_status IN ('inbound', 'installed', 'online', 'maintenance', 'repairing', 'retired')
    ),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    note text,
    actor_user_id uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_lifecycle_events_device_time_idx
    ON device_lifecycle_events (device_id, occurred_at DESC, id DESC);
