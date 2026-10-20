ALTER TABLE export_jobs ADD COLUMN progress_json jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX export_jobs_running_heartbeat_idx ON export_jobs(updated_at) WHERE status = 'running';
