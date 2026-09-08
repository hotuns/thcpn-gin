ALTER TABLE processing_task_versions DROP CONSTRAINT IF EXISTS processing_task_plan_version_fk;
ALTER TABLE processing_task_versions DROP COLUMN IF EXISTS plan_snapshot_json;
ALTER TABLE processing_task_versions DROP COLUMN IF EXISTS plan_version;
ALTER TABLE processing_task_versions DROP COLUMN IF EXISTS plan_id;
DROP TABLE IF EXISTS processing_plan_versions;
DROP TABLE IF EXISTS processing_plans;
