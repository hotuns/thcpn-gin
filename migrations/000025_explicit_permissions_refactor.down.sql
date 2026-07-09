DROP INDEX IF EXISTS access_grants_active_unique;

CREATE UNIQUE INDEX access_grants_active_unique
    ON access_grants (workspace_id, subject_type, subject_id, role_id, scope_type, scope_id)
    WHERE status = 'active';

DROP TABLE IF EXISTS invitation_permissions;
DROP TABLE IF EXISTS access_grant_permissions;
DROP TABLE IF EXISTS workspace_member_permissions;

ALTER TABLE invitations
    DROP COLUMN IF EXISTS template_code;

ALTER TABLE access_grants
    DROP COLUMN IF EXISTS template_code;

ALTER TABLE workspace_members
    DROP COLUMN IF EXISTS template_code;
