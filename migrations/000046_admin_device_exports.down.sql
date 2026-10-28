-- Administrator jobs have no user owner. Preserve them by refusing an unsafe rollback.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM export_jobs WHERE requested_by_admin IS NOT NULL) THEN
    RAISE EXCEPTION 'administrator export jobs must be archived before rolling back this migration';
  END IF;
END $$;
DROP INDEX export_jobs_admin_created_idx;
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_requester_check;
ALTER TABLE export_jobs DROP COLUMN requested_by_admin;
ALTER TABLE export_jobs ALTER COLUMN requested_by SET NOT NULL;
ALTER TABLE export_jobs ALTER COLUMN workspace_id SET NOT NULL;
