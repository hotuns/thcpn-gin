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

DROP INDEX IF EXISTS data_sources_workspace_name_unique;
DROP INDEX IF EXISTS data_sources_workspace_status_idx;
DROP INDEX IF EXISTS data_sources_system_name_unique;
DROP INDEX IF EXISTS data_sources_system_status_idx;

ALTER TABLE data_sources
    DROP CONSTRAINT IF EXISTS data_sources_scope_workspace_check,
    DROP COLUMN IF EXISTS scope,
    DROP COLUMN IF EXISTS workspace_id;

CREATE UNIQUE INDEX data_sources_name_unique
    ON data_sources (lower(name));

CREATE INDEX data_sources_status_idx
    ON data_sources (status, created_at DESC);

ALTER TABLE data_streams
    DROP CONSTRAINT IF EXISTS data_streams_device_id_workspace_id_fkey,
    DROP COLUMN IF EXISTS workspace_id;

DROP INDEX IF EXISTS device_source_refs_workspace_status_idx;

ALTER TABLE device_source_refs
    DROP CONSTRAINT IF EXISTS device_source_refs_device_id_workspace_id_fkey,
    DROP COLUMN IF EXISTS workspace_id;

ALTER TABLE devices
    DROP CONSTRAINT IF EXISTS devices_site_id_project_id_workspace_id_fkey,
    DROP CONSTRAINT IF EXISTS devices_project_id_workspace_id_fkey,
    DROP CONSTRAINT IF EXISTS devices_id_workspace_id_key,
    DROP COLUMN IF EXISTS workspace_id,
    DROP COLUMN IF EXISTS project_id,
    DROP COLUMN IF EXISTS site_id,
    DROP COLUMN IF EXISTS bound_by;

ALTER TABLE data_streams
    ADD CONSTRAINT data_streams_device_id_fkey
        FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE;

CREATE TABLE device_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    project_id uuid,
    site_id uuid,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'transferred', 'removed')),
    assigned_by uuid REFERENCES users (id),
    assigned_at timestamptz NOT NULL DEFAULT now(),
    unassigned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (site_id IS NULL OR project_id IS NOT NULL),
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id),
    FOREIGN KEY (site_id, project_id, workspace_id) REFERENCES sites (id, project_id, workspace_id)
);

CREATE UNIQUE INDEX device_assignments_active_device_unique
    ON device_assignments (device_id)
    WHERE status = 'active';

CREATE INDEX device_assignments_workspace_idx
    ON device_assignments (workspace_id, status, assigned_at DESC);

CREATE INDEX device_assignments_project_idx
    ON device_assignments (project_id, status, assigned_at DESC)
    WHERE project_id IS NOT NULL;

CREATE INDEX device_assignments_site_idx
    ON device_assignments (site_id, status, assigned_at DESC)
    WHERE site_id IS NOT NULL;

ALTER TABLE device_source_refs
    ADD CONSTRAINT device_source_refs_device_id_fkey
        FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE;
