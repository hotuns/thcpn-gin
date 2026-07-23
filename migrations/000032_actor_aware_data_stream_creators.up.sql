ALTER TABLE data_streams
    DROP CONSTRAINT IF EXISTS data_streams_created_by_fkey,
    ADD COLUMN created_by_type text NOT NULL DEFAULT 'user'
        CHECK (created_by_type IN ('user', 'system_admin', 'system'));

ALTER TABLE data_stream_bindings
    DROP CONSTRAINT IF EXISTS data_stream_bindings_created_by_fkey,
    ADD COLUMN created_by_type text NOT NULL DEFAULT 'user'
        CHECK (created_by_type IN ('user', 'system_admin', 'system'));

COMMENT ON COLUMN data_streams.created_by IS
    'Audit actor identifier; interpret together with created_by_type. This is not resource ownership.';
COMMENT ON COLUMN data_stream_bindings.created_by IS
    'Audit actor identifier; interpret together with created_by_type. This is not resource ownership.';
