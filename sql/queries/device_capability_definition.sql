-- name: ListDeviceCapabilityDefinitions :many
SELECT code, name, status, sort_order, created_at, updated_at
FROM device_capability_definitions
ORDER BY sort_order ASC, code ASC;

-- name: ListDeviceCapabilityDefinitionsByCodes :many
SELECT code, name, status, sort_order, created_at, updated_at
FROM device_capability_definitions
WHERE code = ANY(sqlc.arg(codes)::text[])
ORDER BY sort_order ASC, code ASC;

-- name: CreateDeviceCapabilityDefinition :one
INSERT INTO device_capability_definitions (code, name, status, sort_order)
VALUES ($1, $2, $3, $4)
RETURNING code, name, status, sort_order, created_at, updated_at;

-- name: UpdateDeviceCapabilityDefinition :one
UPDATE device_capability_definitions
SET name = $2,
    status = $3,
    sort_order = $4,
    updated_at = now()
WHERE code = $1
RETURNING code, name, status, sort_order, created_at, updated_at;
