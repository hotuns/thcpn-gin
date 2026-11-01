CREATE TABLE device_installation_records (
 device_id uuid PRIMARY KEY REFERENCES devices(id),
 installed_on date,
 installer_id uuid REFERENCES system_admins(id),
 contact_name text NOT NULL DEFAULT '',
 contact_phone text NOT NULL DEFAULT '',
 organization text NOT NULL DEFAULT '',
 project_name text NOT NULL DEFAULT '',
 retired_on date,
 retirement_reason text NOT NULL DEFAULT '',
 ops_tags text[] NOT NULL DEFAULT '{}',
 updated_by uuid REFERENCES system_admins(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE device_workspace_tags (
 device_id uuid NOT NULL REFERENCES devices(id),
 workspace_id uuid NOT NULL REFERENCES workspaces(id),
 tags text[] NOT NULL DEFAULT '{}',
 updated_by uuid REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(device_id,workspace_id)
);
-- Preserve old user-facing tags in the currently assigned workspace.
INSERT INTO device_workspace_tags(device_id,workspace_id,tags)
 SELECT p.device_id,a.workspace_id,p.research_tags FROM device_environment_profiles p
 JOIN device_assignments a ON a.device_id=p.device_id AND a.status='active'
 WHERE cardinality(p.research_tags)>0 ON CONFLICT DO NOTHING;
-- Keep historical event statuses unchanged; simplify the current deployment state.
UPDATE devices SET lifecycle_status='online' WHERE lifecycle_status IN ('installed','maintenance','repairing');
ALTER TABLE devices DROP CONSTRAINT devices_lifecycle_status_check;
ALTER TABLE devices ADD CONSTRAINT devices_lifecycle_status_check CHECK(lifecycle_status IN ('inbound','online','retired'));
