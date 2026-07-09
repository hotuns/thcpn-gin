ALTER TABLE workspace_members
    ADD COLUMN scope_type text NOT NULL DEFAULT 'workspace',
    ADD COLUMN scope_id uuid;

UPDATE workspace_members
SET scope_id = workspace_id
WHERE scope_id IS NULL;

ALTER TABLE workspace_members
    ALTER COLUMN scope_id SET NOT NULL,
    ADD CONSTRAINT workspace_members_scope_type_check
        CHECK (scope_type IN ('workspace', 'project', 'site', 'device', 'dataset'));

CREATE INDEX workspace_members_workspace_user_status_idx
    ON workspace_members (workspace_id, user_id, status);

CREATE INDEX workspace_members_scope_status_idx
    ON workspace_members (workspace_id, scope_type, scope_id, status);
