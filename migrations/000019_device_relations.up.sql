CREATE TABLE device_relations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    child_device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    relation_type text NOT NULL CHECK (relation_type IN ('gateway_node')),
    data_source_id uuid NOT NULL REFERENCES data_sources (id) ON DELETE CASCADE,
    external_parent_device_id bigint NOT NULL CHECK (external_parent_device_id > 0),
    external_child_device_id bigint NOT NULL CHECK (external_child_device_id > 0),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (parent_device_id <> child_device_id),
    UNIQUE (parent_device_id, child_device_id, relation_type),
    UNIQUE (data_source_id, relation_type, external_parent_device_id, external_child_device_id)
);

CREATE INDEX device_relations_parent_status_idx
    ON device_relations (parent_device_id, relation_type, status, synced_at DESC);

CREATE INDEX device_relations_child_status_idx
    ON device_relations (child_device_id, relation_type, status, synced_at DESC);

CREATE INDEX device_relations_external_parent_idx
    ON device_relations (data_source_id, relation_type, external_parent_device_id, status);
