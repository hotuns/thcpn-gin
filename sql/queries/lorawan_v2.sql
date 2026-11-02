-- name: UpsertLoRaWANV2Metadata :exec
INSERT INTO device_metadata (device_id, key, name, value_type, value_json, unit, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)
ON CONFLICT (device_id, key) DO UPDATE SET
    name = EXCLUDED.name,
    value_type = EXCLUDED.value_type,
    value_json = EXCLUDED.value_json,
    unit = EXCLUDED.unit,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

-- name: ListLoRaWANV2GatewayStatusStreams :many
SELECT ds.id, (b.adapter_config_json->>'metric')::text AS metric
FROM data_streams ds
JOIN data_stream_bindings b ON b.data_stream_id=ds.id AND b.status='active' AND b.adapter_code='lorawan_v2'
JOIN device_source_refs r ON r.device_id=ds.device_id AND r.data_source_id=b.data_source_id AND r.status='active' AND r.adapter_code='lorawan_v2'
WHERE ds.device_id=$1 AND ds.status='active' AND ds.type='telemetry' AND ds.purpose='status'
  AND b.adapter_config_json->>'gateway_sn'=r.external_key
  AND b.adapter_config_json->>'node_index' IS NULL
  AND b.adapter_config_json->>'metric' IN ('battery','cell')
ORDER BY ds.id;
