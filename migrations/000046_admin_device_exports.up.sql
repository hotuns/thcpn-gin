ALTER TABLE export_jobs ALTER COLUMN workspace_id DROP NOT NULL;
ALTER TABLE export_jobs ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE export_jobs ADD COLUMN requested_by_admin uuid REFERENCES system_admins(id);
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_requester_check CHECK (
  (requested_by_admin IS NOT NULL AND requested_by IS NULL AND workspace_id IS NULL)
  OR (requested_by_admin IS NULL AND requested_by IS NOT NULL AND workspace_id IS NOT NULL)
);
CREATE INDEX export_jobs_admin_created_idx ON export_jobs(created_at DESC) WHERE requested_by_admin IS NOT NULL;
