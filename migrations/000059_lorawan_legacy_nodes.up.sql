CREATE TABLE lorawan_legacy_nodes (
 gateway_device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 node_index integer NOT NULL CHECK (node_index BETWEEN 1 AND 254),
 PRIMARY KEY (gateway_device_id, node_index)
);

COMMENT ON TABLE lorawan_legacy_nodes IS 'Explicitly migrated active LoRaWAN V2 node indices with no known physical SN. Never derived from gateway capacity.';
