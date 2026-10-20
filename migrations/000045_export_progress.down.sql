DROP INDEX export_jobs_running_heartbeat_idx;
ALTER TABLE export_jobs DROP COLUMN progress_json;
