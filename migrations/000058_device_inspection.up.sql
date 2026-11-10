CREATE TABLE device_inspection_state (
    device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    next_check_at timestamptz NOT NULL,
    checked_at timestamptz,
    latest_sample_at timestamptz,
    schedule_known boolean NOT NULL DEFAULT false,
    error text NOT NULL DEFAULT '',
    progress jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX device_inspection_due_idx ON device_inspection_state(next_check_at);
CREATE TABLE device_inspection_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family text NOT NULL CHECK (family IN ('thcpn','carbon')),
    device_type text NOT NULL DEFAULT 'all' CHECK (device_type IN ('all','standalone','gateway','gateway_node')),
    metric_code text NOT NULL,
    unit text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('range','invalid','zero')),
    lower_value double precision,
    upper_value double precision,
    invalid_value double precision,
    consecutive integer NOT NULL CHECK (consecutive BETWEEN 2 AND 100),
    enabled boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(family,device_type,metric_code,unit,kind)
);
CREATE TABLE device_inspection_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    event_key text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('late','missing','range','invalid','zero')),
    metric text NOT NULL,
    node_index integer,
    detail text NOT NULL,
    started_at timestamptz NOT NULL,
    detected_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL,
    resolved_at timestamptz,
    acknowledged_at timestamptz,
    acknowledged_by uuid REFERENCES system_admins(id) ON DELETE SET NULL,
    note text NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX device_inspection_open_idx ON device_inspection_events(device_id,event_key) WHERE resolved_at IS NULL;
CREATE INDEX device_inspection_events_time_idx ON device_inspection_events(started_at DESC,id);
CREATE INDEX device_inspection_events_daily_new_idx ON device_inspection_events(detected_at);
CREATE INDEX device_inspection_events_daily_resolved_idx ON device_inspection_events(resolved_at) WHERE resolved_at IS NOT NULL;
