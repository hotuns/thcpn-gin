-- name: UpsertCameraDevice :one
INSERT INTO devices (
    product_id,
    serial_no,
    name,
    status,
    activated_at,
    lifecycle_status,
    lifecycle_updated_at,
    device_type
)
VALUES ($1, $2, $3, 'active', now(), 'online', now(), 'camera')
ON CONFLICT (serial_no)
DO UPDATE SET
    product_id = EXCLUDED.product_id,
    name = EXCLUDED.name,
    status = 'active',
    lifecycle_status = CASE
        WHEN devices.lifecycle_status = 'inbound' THEN 'online'
        ELSE devices.lifecycle_status
    END,
    lifecycle_updated_at = COALESCE(devices.lifecycle_updated_at, now()),
    device_type = 'camera',
    updated_at = now()
RETURNING id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type;

-- name: UpsertCameraBinding :one
INSERT INTO camera_bindings (
    device_id,
    provider,
    device_serial,
    channel_no,
    default_quality,
    is_encrypted,
    validate_code_secret_ref,
    status
)
VALUES ($1, 'ezviz', $2, $3, $4, $5, $6, $7)
ON CONFLICT (device_id)
DO UPDATE SET
    device_serial = EXCLUDED.device_serial,
    channel_no = EXCLUDED.channel_no,
    default_quality = EXCLUDED.default_quality,
    is_encrypted = EXCLUDED.is_encrypted,
    validate_code_secret_ref = EXCLUDED.validate_code_secret_ref,
    status = EXCLUDED.status,
    updated_at = now()
RETURNING id, device_id, provider, device_serial, channel_no, default_quality, is_encrypted, validate_code_secret_ref, status, created_at, updated_at;

-- name: GetCameraBindingByDevice :one
SELECT id, device_id, provider, device_serial, channel_no, default_quality, is_encrypted, validate_code_secret_ref, status, created_at, updated_at
FROM camera_bindings
WHERE device_id = $1;

-- name: ListCameraBindingsByDevices :many
SELECT id, device_id, provider, device_serial, channel_no, default_quality, is_encrypted, validate_code_secret_ref, status, created_at, updated_at
FROM camera_bindings
WHERE device_id = ANY($1::uuid[])
ORDER BY created_at DESC, id DESC;

-- name: UpdateCameraBindingStatus :one
UPDATE camera_bindings
SET status = $2,
    updated_at = now()
WHERE device_id = $1
RETURNING id, device_id, provider, device_serial, channel_no, default_quality, is_encrypted, validate_code_secret_ref, status, created_at, updated_at;
