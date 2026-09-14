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
