CREATE TABLE node_profiles (
 device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 node_index integer NOT NULL CHECK (node_index > 0),
 name varchar(50) NOT NULL DEFAULT '',
 updated_by uuid NOT NULL,
 updated_by_type text NOT NULL CHECK (updated_by_type IN ('user', 'system_admin')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (device_id, node_index)
);
