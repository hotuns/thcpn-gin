-- name: CreateDataSource :one
INSERT INTO data_sources (workspace_id, name, type, dsn_secret_ref, created_by)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at;

-- name: GetDataSource :one
SELECT id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at
FROM data_sources
WHERE id = $1;

-- name: ListDataSourcesByWorkspace :many
SELECT id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at
FROM data_sources
WHERE workspace_id = $1
ORDER BY created_at DESC, id DESC;

-- name: UpdateDataSource :one
UPDATE data_sources
SET name = $2,
    type = $3,
    dsn_secret_ref = $4,
    status = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, workspace_id, name, type, dsn_secret_ref, status, created_by, created_at, updated_at;

-- name: CreateDataStreamBinding :one
INSERT INTO data_stream_bindings (
    data_stream_id,
    data_source_id,
    database_name,
    schema_name,
    table_name,
    device_key_field,
    device_key_value,
    time_field,
    value_field,
    payload_type,
    query_config_json,
    created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, query_config_json, status, created_by, created_at, updated_at;

-- name: GetDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, query_config_json, status, created_by, created_at, updated_at
FROM data_stream_bindings
WHERE id = $1;

-- name: ListDataStreamBindingsByDataStream :many
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, query_config_json, status, created_by, created_at, updated_at
FROM data_stream_bindings
WHERE data_stream_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetActiveDataStreamBinding :one
SELECT id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, query_config_json, status, created_by, created_at, updated_at
FROM data_stream_bindings
WHERE data_stream_id = $1
  AND status = 'active'
ORDER BY created_at DESC, id DESC
LIMIT 1;

-- name: UpdateDataStreamBinding :one
UPDATE data_stream_bindings
SET data_source_id = $2,
    database_name = $3,
    schema_name = $4,
    table_name = $5,
    device_key_field = $6,
    device_key_value = $7,
    time_field = $8,
    value_field = $9,
    payload_type = $10,
    query_config_json = $11,
    status = $12,
    updated_at = now()
WHERE id = $1
RETURNING id, data_stream_id, data_source_id, database_name, schema_name, table_name, device_key_field, device_key_value, time_field, value_field, payload_type, query_config_json, status, created_by, created_at, updated_at;
