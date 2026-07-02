ALTER TABLE users
    ADD COLUMN is_system_admin boolean NOT NULL DEFAULT false;

ALTER TABLE data_sources
    ADD COLUMN scope text NOT NULL DEFAULT 'workspace' CHECK (scope IN ('workspace', 'system'));

DROP INDEX IF EXISTS data_sources_workspace_name_unique;
DROP INDEX IF EXISTS data_sources_workspace_status_idx;

ALTER TABLE data_sources
    ALTER COLUMN workspace_id DROP NOT NULL;

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
