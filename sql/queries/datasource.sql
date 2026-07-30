-- name: CreateDataSource :one
INSERT INTO data_sources (name, type, dsn_secret_ref, created_by)
VALUES ($1, $2, $3, $4)
RETURNING id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at;

-- name: GetDataSource :one
SELECT id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at
FROM data_sources
WHERE id = $1;

-- name: ListDataSources :many
SELECT id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at
FROM data_sources
ORDER BY created_at DESC, id DESC;

-- name: UpdateDataSource :one
UPDATE data_sources
SET name = $2,
    type = $3,
    dsn_secret_ref = $4,
    status = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at;

-- name: CreateDataStreamBinding :one
INSERT INTO data_stream_bindings (
    data_stream_id,
    data_source_id,
    adapter_code,
    database_name,
    schema_name,
    table_name,
    device_key_field,
    device_key_value,
    time_field,
    value_field,
    payload_type,
    adapter_config_json,
    created_by,
    created_by_type
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at, adapter_code, created_by_type;

-- name: GetDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at, adapter_code, created_by_type
FROM data_stream_bindings
WHERE id = $1;

-- name: ListDataStreamBindingsByDataStream :many
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at, adapter_code, created_by_type
FROM data_stream_bindings
WHERE data_stream_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetActiveDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at, adapter_code, created_by_type
FROM data_stream_bindings
WHERE data_stream_id = $1
  AND status = 'active'
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: UpdateDataStreamBinding :one
UPDATE data_stream_bindings
SET data_source_id = $2,
    adapter_code = $3,
    database_name = $4,
    schema_name = $5,
    table_name = $6,
    device_key_field = $7,
    device_key_value = $8,
    time_field = $9,
    value_field = $10,
    payload_type = $11,
    adapter_config_json = $12,
    status = $13,
    updated_at = now()
WHERE id = $1
RETURNING id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at, adapter_code, created_by_type;

-- name: DisableMissingTHCPNDataStreamBindings :many
UPDATE data_stream_bindings AS dsb
SET status = 'disabled',
    updated_at = now()
FROM data_streams AS ds
WHERE ds.id = dsb.data_stream_id
  AND ds.device_id = sqlc.arg(device_id)
  AND dsb.data_source_id = sqlc.arg(data_source_id)
  AND dsb.adapter_code = 'thcpn_legacy_mysql'
  AND dsb.status = 'active'
  AND (dsb.adapter_config_json->>'external_device_id')::bigint = sqlc.arg(external_device_id)::bigint
  AND NOT (ds.code = ANY(sqlc.arg(active_codes)::text[]))
RETURNING dsb.id, dsb.data_stream_id, dsb.data_source_id, dsb.database_name, dsb.schema_name, dsb.table_name, dsb.device_key_field, dsb.device_key_value, dsb.time_field, dsb.value_field, dsb.payload_type, dsb.adapter_config_json, dsb.status, dsb.created_by, dsb.created_at, dsb.updated_at, dsb.adapter_code, dsb.created_by_type;
