-- name: UpsertNumericDeviceSourceRef :one
INSERT INTO device_source_refs (
    device_id,
    data_source_id,
    adapter_code,
    external_key,
    status,
    synced_at
)
VALUES ($1, $2, $3, sqlc.arg(external_device_id)::bigint::text, 'active', now())
ON CONFLICT (data_source_id, adapter_code, external_key)
DO UPDATE SET
    device_id = EXCLUDED.device_id,
    status = 'active',
    synced_at = now(),
    updated_at = now()
RETURNING id, device_id, data_source_id, adapter_code, external_key::bigint AS external_device_id, status, synced_at, created_at, updated_at;

-- name: GetNumericDeviceSourceRefByExternal :one
SELECT id, device_id, data_source_id, adapter_code, external_key::bigint AS external_device_id, status, synced_at, created_at, updated_at
FROM device_source_refs
WHERE data_source_id = $1
  AND adapter_code = $2
  AND external_key = sqlc.arg(external_device_id)::bigint::text;

-- name: GetNumericDeviceSourceRefByDevice :one
SELECT id, device_id, data_source_id, adapter_code, external_key::bigint AS external_device_id, status, synced_at, created_at, updated_at
FROM device_source_refs
WHERE device_id = $1
  AND adapter_code IN ('thcpn_legacy_mysql', 'thcpn_legacy_camera', 'carbon_sink_mysql')
  AND status = 'active'
;

-- name: GetActiveTHCPNDeviceSourceRefByDevice :one
SELECT id, device_id, data_source_id, adapter_code, external_key::bigint AS external_device_id, status, synced_at, created_at, updated_at
FROM device_source_refs
WHERE device_id = $1
  AND adapter_code = 'thcpn_legacy_mysql'
  AND status = 'active'
;

-- name: UpsertDeviceConfigSnapshot :one
INSERT INTO device_config_snapshots (
    device_id,
    data_source_id,
    adapter_code,
    external_device_id,
    external_config_id,
    version,
    data_json,
    image_json,
    control_json,
    source_created_at,
    source_updated_at,
    synced_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
ON CONFLICT (data_source_id, adapter_code, external_config_id)
DO UPDATE SET
    device_id = EXCLUDED.device_id,
    external_device_id = EXCLUDED.external_device_id,
    version = EXCLUDED.version,
    data_json = EXCLUDED.data_json,
    image_json = EXCLUDED.image_json,
    control_json = EXCLUDED.control_json,
    source_created_at = EXCLUDED.source_created_at,
    source_updated_at = EXCLUDED.source_updated_at,
    synced_at = now()
RETURNING id, device_id, data_source_id, adapter_code, external_device_id, external_config_id, version, data_json, image_json, control_json, source_created_at, source_updated_at, synced_at, created_at;

-- name: GetDeviceConfigSnapshotByExternalConfig :one
SELECT id, device_id, data_source_id, adapter_code, external_device_id, external_config_id, version, data_json, image_json, control_json, source_created_at, source_updated_at, synced_at, created_at
FROM device_config_snapshots
WHERE data_source_id = $1
  AND adapter_code = $2
  AND external_config_id = $3;

-- name: ListDeviceConfigSnapshotsByDevice :many
SELECT id, device_id, data_source_id, adapter_code, external_device_id, external_config_id, version, data_json, image_json, control_json, source_created_at, source_updated_at, synced_at, created_at
FROM device_config_snapshots
WHERE device_id = $1
ORDER BY synced_at DESC, external_config_id DESC;

-- name: GetLatestDeviceConfigSnapshotByDevice :one
SELECT id, device_id, data_source_id, adapter_code, external_device_id, external_config_id, version, data_json, image_json, control_json, source_created_at, source_updated_at, synced_at, created_at
FROM device_config_snapshots
WHERE device_id = $1
ORDER BY synced_at DESC, external_config_id DESC
LIMIT 1;
