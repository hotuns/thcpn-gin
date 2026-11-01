ALTER TABLE devices DROP CONSTRAINT devices_lifecycle_status_check;
ALTER TABLE devices ADD CONSTRAINT devices_lifecycle_status_check CHECK(lifecycle_status IN ('inbound','installed','online','maintenance','repairing','retired'));
DROP TABLE device_workspace_tags;
DROP TABLE device_installation_records;
