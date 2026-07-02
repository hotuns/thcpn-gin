DROP INDEX IF EXISTS data_sources_workspace_status_idx;
DROP INDEX IF EXISTS data_sources_system_status_idx;
DROP INDEX IF EXISTS data_sources_workspace_name_unique;
DROP INDEX IF EXISTS data_sources_system_name_unique;

ALTER TABLE data_sources
    DROP CONSTRAINT IF EXISTS data_sources_scope_workspace_check;

DELETE FROM data_sources
WHERE workspace_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM workspaces);

UPDATE data_sources
SET workspace_id = (
    SELECT id
    FROM workspaces
    WHERE status = 'active'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
)
WHERE workspace_id IS NULL;

ALTER TABLE data_sources
    ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE data_sources
    DROP COLUMN scope;

CREATE UNIQUE INDEX data_sources_workspace_name_unique
    ON data_sources (workspace_id, lower(name));

CREATE INDEX data_sources_workspace_status_idx
    ON data_sources (workspace_id, status, created_at DESC);

ALTER TABLE users
    DROP COLUMN is_system_admin;
