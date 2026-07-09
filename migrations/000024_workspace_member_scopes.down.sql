DROP INDEX IF EXISTS workspace_members_scope_status_idx;
DROP INDEX IF EXISTS workspace_members_workspace_user_status_idx;

ALTER TABLE workspace_members
    DROP CONSTRAINT IF EXISTS workspace_members_scope_type_check,
    DROP COLUMN IF EXISTS scope_id,
    DROP COLUMN IF EXISTS scope_type;
