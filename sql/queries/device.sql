-- name: CreateDevice :one
INSERT INTO devices (
    workspace_id,
    project_id,
    site_id,
    product_id,
    serial_no,
    name,
    status,
    activated_at,
    bound_by
)
VALUES ($1, $2, $3, $4, $5, $6, 'active', now(), $7)
RETURNING id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at;

-- name: GetDevice :one
SELECT id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at
FROM devices
WHERE id = $1;

-- name: ListDevicesByWorkspace :many
SELECT id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at
FROM devices
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListDevicesByProject :many
SELECT id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at
FROM devices
WHERE project_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListDevicesBySite :many
SELECT id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at
FROM devices
WHERE site_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateDevice :one
UPDATE devices
SET project_id = $2,
    site_id = $3,
    product_id = $4,
    serial_no = $5,
    name = $6,
    status = $7,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, project_id, site_id, product_id, serial_no, name, status, activated_at, bound_by, created_at, updated_at;

-- name: ListDeviceCapabilities :many
SELECT capability_code
FROM device_capabilities
WHERE device_id = $1
ORDER BY capability_code ASC;

-- name: DeleteDeviceCapabilities :exec
DELETE FROM device_capabilities
WHERE device_id = $1;

-- name: AddDeviceCapability :one
INSERT INTO device_capabilities (device_id, capability_code)
VALUES ($1, $2)
ON CONFLICT (device_id, capability_code) DO NOTHING
RETURNING id, device_id, capability_code, created_at;

-- name: CreateDeviceOperation :one
INSERT INTO device_operations (
    workspace_id,
    device_id,
    operation_type,
    request_json,
    requested_by
)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, workspace_id, device_id, operation_type, status, request_json, requested_by, created_at, updated_at;

-- name: ListDeviceOperationsByDevice :many
SELECT id, workspace_id, device_id, operation_type, status, request_json, requested_by, created_at, updated_at
FROM device_operations
WHERE device_id = $1
ORDER BY created_at DESC, id DESC;
