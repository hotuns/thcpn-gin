DROP INDEX IF EXISTS data_stream_bindings_mapping_unique_idx;

DELETE FROM data_stream_bindings
WHERE adapter_code = 'thcpn_legacy_mysql'
   OR table_name IS NULL
   OR device_key_field IS NULL
   OR device_key_value IS NULL
   OR time_field IS NULL
   OR value_field IS NULL;

ALTER TABLE data_stream_bindings
    ALTER COLUMN table_name SET NOT NULL,
    ALTER COLUMN device_key_field SET NOT NULL,
    ALTER COLUMN device_key_value SET NOT NULL,
    ALTER COLUMN time_field SET NOT NULL,
    ALTER COLUMN value_field SET NOT NULL;

ALTER TABLE data_stream_bindings
    RENAME COLUMN adapter_config_json TO query_config_json;

ALTER TABLE data_stream_bindings
    DROP CONSTRAINT IF EXISTS data_stream_bindings_adapter_code_check,
    DROP COLUMN adapter_code;

ALTER TABLE data_stream_bindings
    ADD CONSTRAINT data_stream_bindings_stream_source_mapping_unique
        UNIQUE (data_stream_id, data_source_id, table_name, device_key_field, device_key_value, time_field, value_field);
