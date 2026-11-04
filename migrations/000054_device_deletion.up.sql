ALTER TABLE source_operations DROP CONSTRAINT source_operations_kind_check;
ALTER TABLE source_operations ADD CONSTRAINT source_operations_kind_check CHECK (kind IN ('sync_all','config_update','device_delete'));
