ALTER TABLE data_streams
    DROP CONSTRAINT data_streams_device_id_workspace_id_fkey,
    ADD CONSTRAINT data_streams_device_id_workspace_id_fkey
        FOREIGN KEY (device_id, workspace_id)
        REFERENCES devices (id, workspace_id)
        ON UPDATE CASCADE
        ON DELETE CASCADE;
