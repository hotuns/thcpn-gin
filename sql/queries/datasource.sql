-- name: CreateDataSource :one
INSERT INTO data_sources (scope, workspace_id, name, type, dsn_secret_ref, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at, scope;

-- name: GetDataSource :one
SELECT id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at, scope
FROM data_sources
WHERE id = $1;

-- name: ListDataSourcesByWorkspace :many
SELECT id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at, scope
FROM data_sources
WHERE scope = 'workspace'
  AND workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: ListSystemDataSources :many
SELECT id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at, scope
FROM data_sources
WHERE scope = 'system'
ORDER BY created_at DESC, id DESC;

-- name: UpdateDataSource :one
UPDATE data_sources
SET name = $2,
    type = $3,
    dsn_secret_ref = $4,
    status = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at, scope;

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
    created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id, data_stream_id, data_source_id, adapter_code, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at;

-- name: GetDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, adapter_code, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at
FROM data_stream_bindings
WHERE id = $1;

-- name: ListDataStreamBindingsByDataStream :many
SELECT id, data_stream_id, data_source_id, adapter_code, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at
FROM data_stream_bindings
WHERE data_stream_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetActiveDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, adapter_code, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at
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
RETURNING id, data_stream_id, data_source_id, adapter_code, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, adapter_config_json, status, created_by, created_at, updated_at;
