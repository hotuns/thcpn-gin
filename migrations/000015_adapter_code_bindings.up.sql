ALTER TABLE data_stream_bindings
    ADD COLUMN adapter_code text;

UPDATE data_stream_bindings AS b
SET adapter_code = CASE
    WHEN s.type = 'http_api' THEN 'http_api'
    WHEN b.payload_type = 'media' THEN 'generic_media'
    ELSE 'generic_columns'
END
FROM data_sources AS s
WHERE b.data_source_id = s.id;

UPDATE data_stream_bindings
SET adapter_code = CASE
    WHEN payload_type = 'media' THEN 'generic_media'
    ELSE 'generic_columns'
END
WHERE adapter_code IS NULL;

ALTER TABLE data_stream_bindings
    ALTER COLUMN adapter_code SET NOT NULL,
    ADD CONSTRAINT data_stream_bindings_adapter_code_check
        CHECK (adapter_code IN ('generic_columns', 'generic_media', 'http_api', 'thcpn_legacy_mysql'));

ALTER TABLE data_stream_bindings
    RENAME COLUMN query_config_json TO adapter_config_json;

ALTER TABLE data_stream_bindings
    ALTER COLUMN table_name DROP NOT NULL,
    ALTER COLUMN device_key_field DROP NOT NULL,
    ALTER COLUMN device_key_value DROP NOT NULL,
    ALTER COLUMN time_field DROP NOT NULL,
    ALTER COLUMN value_field DROP NOT NULL;

DO $$
DECLARE
    constraint_name text;
BEGIN
    SELECT con.conname
    INTO constraint_name
    FROM pg_constraint AS con
    JOIN pg_class AS rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'data_stream_bindings'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) LIKE '%data_stream_id%'
      AND pg_get_constraintdef(con.oid) LIKE '%data_source_id%'
      AND pg_get_constraintdef(con.oid) LIKE '%table_name%'
      AND pg_get_constraintdef(con.oid) LIKE '%device_key_field%'
      AND pg_get_constraintdef(con.oid) LIKE '%device_key_value%'
      AND pg_get_constraintdef(con.oid) LIKE '%time_field%'
      AND pg_get_constraintdef(con.oid) LIKE '%value_field%'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE data_stream_bindings DROP CONSTRAINT %I', constraint_name);
    END IF;
END $$;

CREATE UNIQUE INDEX data_stream_bindings_mapping_unique_idx
    ON data_stream_bindings (
        data_stream_id,
        data_source_id,
        adapter_code,
        payload_type,
        COALESCE(table_name, ''),
        COALESCE(device_key_field, ''),
        COALESCE(device_key_value, ''),
        COALESCE(time_field, ''),
        COALESCE(value_field, '')
    );
