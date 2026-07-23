ALTER TABLE data_stream_bindings
    DROP COLUMN IF EXISTS created_by_type,
    ADD CONSTRAINT data_stream_bindings_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users (id);

ALTER TABLE data_streams
    DROP COLUMN IF EXISTS created_by_type,
    ADD CONSTRAINT data_streams_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES users (id);
