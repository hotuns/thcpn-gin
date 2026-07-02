DELETE FROM access_grants;
DELETE FROM invitations;
DELETE FROM audit_logs;
DELETE FROM export_jobs;
DELETE FROM dataset_sources;
DELETE FROM datasets;
DELETE FROM device_operations;
DELETE FROM device_config_snapshots;
DELETE FROM device_source_refs;
DELETE FROM data_stream_bindings;
DELETE FROM data_streams;
DELETE FROM device_capabilities;
DELETE FROM devices;
DELETE FROM data_sources;

ALTER TABLE device_source_refs
    DROP CONSTRAINT IF EXISTS device_source_refs_device_id_fkey,
    ADD COLUMN IF NOT EXISTS workspace_id uuid;

ALTER TABLE data_streams
    DROP CONSTRAINT IF EXISTS data_streams_device_id_fkey,
    ADD COLUMN IF NOT EXISTS workspace_id uuid;

DROP TABLE IF EXISTS device_assignments;

ALTER TABLE devices
    ADD COLUMN IF NOT EXISTS workspace_id uuid,
    ADD COLUMN IF NOT EXISTS project_id uuid,
    ADD COLUMN IF NOT EXISTS site_id uuid,
    ADD COLUMN IF NOT EXISTS bound_by uuid;

ALTER TABLE data_sources
    ADD COLUMN IF NOT EXISTS workspace_id uuid,
    ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'workspace';

DROP INDEX IF EXISTS data_sources_name_unique;
DROP INDEX IF EXISTS data_sources_status_idx;

ALTER TABLE data_sources
    ADD CONSTRAINT data_sources_scope_workspace_check CHECK (
        (scope = 'workspace' AND workspace_id IS NOT NULL)
        OR
        (scope = 'system' AND workspace_id IS NULL)
    );

CREATE UNIQUE INDEX data_sources_system_name_unique
    ON data_sources (lower(name))
    WHERE scope = 'system';

CREATE UNIQUE INDEX data_sources_workspace_name_unique
    ON data_sources (workspace_id, lower(name))
    WHERE scope = 'workspace';

CREATE INDEX data_sources_system_status_idx
    ON data_sources (scope, status, created_at DESC)
    WHERE scope = 'system';

CREATE INDEX data_sources_workspace_status_idx
    ON data_sources (workspace_id, status, created_at DESC)
    WHERE scope = 'workspace';

ALTER TABLE devices
    ADD CONSTRAINT devices_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    ADD CONSTRAINT devices_project_id_workspace_id_fkey
        FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id),
    ADD CONSTRAINT devices_site_id_project_id_workspace_id_fkey
        FOREIGN KEY (site_id, project_id, workspace_id) REFERENCES sites (id, project_id, workspace_id),
    ADD CONSTRAINT devices_id_workspace_id_key UNIQUE (id, workspace_id);

ALTER TABLE data_streams
    ADD CONSTRAINT data_streams_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    ADD CONSTRAINT data_streams_device_id_workspace_id_fkey
        FOREIGN KEY (device_id, workspace_id) REFERENCES devices (id, workspace_id) ON DELETE CASCADE;

ALTER TABLE device_source_refs
    ADD CONSTRAINT device_source_refs_workspace_id_fkey
        FOREIGN KEY (workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE,
    ADD CONSTRAINT device_source_refs_device_id_workspace_id_fkey
        FOREIGN KEY (device_id, workspace_id) REFERENCES devices (id, workspace_id) ON DELETE CASCADE;

CREATE INDEX device_source_refs_workspace_status_idx
    ON device_source_refs (workspace_id, status, synced_at DESC);
