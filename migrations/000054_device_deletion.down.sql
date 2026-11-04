-- Preserve deletion audit and recovery records when rolling back the application.
ALTER TABLE source_operations DROP CONSTRAINT source_operations_kind_check;
ALTER TABLE source_operations ADD CONSTRAINT source_operations_kind_check CHECK (kind IN ('sync_all','config_update')) NOT VALID;
