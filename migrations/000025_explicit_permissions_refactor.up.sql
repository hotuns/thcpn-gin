ALTER TABLE workspace_members
    ADD COLUMN template_code text;

ALTER TABLE access_grants
    ADD COLUMN template_code text;

ALTER TABLE invitations
    ADD COLUMN template_code text;

UPDATE workspace_members wm
SET template_code = r.code
FROM roles r
WHERE r.id = wm.role_id;

UPDATE access_grants ag
SET template_code = r.code
FROM roles r
WHERE r.id = ag.role_id;

UPDATE invitations i
SET template_code = r.code
FROM roles r
WHERE r.id = i.role_id;

ALTER TABLE workspace_members
    ALTER COLUMN template_code SET NOT NULL;

ALTER TABLE access_grants
    ALTER COLUMN template_code SET NOT NULL;

ALTER TABLE invitations
    ALTER COLUMN template_code SET NOT NULL;

CREATE TABLE workspace_member_permissions (
    member_id uuid NOT NULL REFERENCES workspace_members (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (member_id, permission_id)
);

CREATE TABLE access_grant_permissions (
    access_grant_id uuid NOT NULL REFERENCES access_grants (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (access_grant_id, permission_id)
);

CREATE TABLE invitation_permissions (
    invitation_id uuid NOT NULL REFERENCES invitations (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (invitation_id, permission_id)
);

INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT wm.id, rp.permission_id
FROM workspace_members wm
JOIN role_permissions rp ON rp.role_id = wm.role_id
ON CONFLICT DO NOTHING;

INSERT INTO access_grant_permissions (access_grant_id, permission_id)
SELECT ag.id, rp.permission_id
FROM access_grants ag
JOIN role_permissions rp ON rp.role_id = ag.role_id
ON CONFLICT DO NOTHING;

INSERT INTO invitation_permissions (invitation_id, permission_id)
SELECT i.id, rp.permission_id
FROM invitations i
JOIN role_permissions rp ON rp.role_id = i.role_id
ON CONFLICT DO NOTHING;

CREATE INDEX workspace_member_permissions_permission_idx
    ON workspace_member_permissions (permission_id);

CREATE INDEX access_grant_permissions_permission_idx
    ON access_grant_permissions (permission_id);

CREATE INDEX invitation_permissions_permission_idx
    ON invitation_permissions (permission_id);

DROP INDEX IF EXISTS access_grants_active_unique;

CREATE UNIQUE INDEX access_grants_active_unique
    ON access_grants (workspace_id, subject_type, subject_id, scope_type, scope_id)
    WHERE status = 'active';
