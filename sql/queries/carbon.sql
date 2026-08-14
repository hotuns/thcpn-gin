-- name: UpsertCarbonNodeMetadata :exec
INSERT INTO device_metadata (device_id, key, name, value_type, value_json, unit, created_by, updated_by)
VALUES ($1, 'carbon_nodes_count', 'Carbon 节点数', 'number', $2::jsonb, NULL, $3, $3)
ON CONFLICT (device_id, key) DO UPDATE SET
    value_json = EXCLUDED.value_json,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

-- name: UpsertCarbonMetadata :exec
INSERT INTO device_metadata (device_id, key, name, value_type, value_json, unit, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)
ON CONFLICT (device_id, key) DO UPDATE SET
    name = EXCLUDED.name,
    value_type = EXCLUDED.value_type,
    value_json = EXCLUDED.value_json,
    unit = EXCLUDED.unit,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

-- name: DeleteCarbonRuntimeMetadata :exec
DELETE FROM device_metadata
WHERE device_id = $1 AND key = ANY($2::text[]);
