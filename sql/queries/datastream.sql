-- name: CreateDataStream :one
INSERT INTO data_streams (device_id, code, name, type, unit, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, device_id, code, name, type, unit, status, created_by, created_at, updated_at;

-- name: UpsertDataStreamFromSync :one
INSERT INTO data_streams (device_id, code, name, type, unit, status, created_by)
VALUES ($1, $2, $3, $4, $5, 'active', $6)
ON CONFLICT (device_id, code)
DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    unit = EXCLUDED.unit,
    status = CASE
        WHEN data_streams.status = 'archived' THEN data_streams.status
        ELSE 'active'
    END,
    updated_at = now()
RETURNING id, device_id, code, name, type, unit, status, created_by, created_at, updated_at;

-- name: GetDataStream :one
SELECT id, device_id, code, name, type, unit, status, created_by, created_at, updated_at
FROM data_streams
WHERE id = $1;

-- name: ListDataStreamsByDevice :many
SELECT id, device_id, code, name, type, unit, status, created_by, created_at, updated_at
FROM data_streams
WHERE device_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateDataStream :one
UPDATE data_streams
SET code = $2,
    name = $3,
    type = $4,
    unit = $5,
    status = $6,
    updated_at = now()
WHERE id = $1
RETURNING id, device_id, code, name, type, unit, status, created_by, created_at, updated_at;
