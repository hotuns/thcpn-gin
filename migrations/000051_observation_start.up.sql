CREATE TABLE device_observation_starts (
 device_id uuid NOT NULL REFERENCES devices(id),
 node_index integer NOT NULL DEFAULT 0 CHECK(node_index>=0),
 starts_at timestamptz NOT NULL,
 updated_by uuid NOT NULL REFERENCES system_admins(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,node_index)
);
CREATE TABLE device_observation_start_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 device_id uuid NOT NULL REFERENCES devices(id),
 node_index integer NOT NULL DEFAULT 0,
 previous_start timestamptz,
 starts_at timestamptz,
 reason text NOT NULL DEFAULT '',
 actor_id uuid NOT NULL REFERENCES system_admins(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON device_observation_start_events(device_id,created_at DESC);
