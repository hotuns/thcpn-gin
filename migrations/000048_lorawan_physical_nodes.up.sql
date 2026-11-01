CREATE TABLE lorawan_physical_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_source_id uuid NOT NULL REFERENCES data_sources(id),
 external_id bigint NOT NULL,
 sn text NOT NULL,
 gateway_device_id uuid REFERENCES devices(id),
 node_index integer,
 synced_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(data_source_id,external_id),
 UNIQUE(data_source_id,sn),
 UNIQUE(gateway_device_id,node_index),
 CHECK ((gateway_device_id IS NULL) = (node_index IS NULL)),
 CHECK (node_index IS NULL OR node_index BETWEEN 1 AND 254)
);
