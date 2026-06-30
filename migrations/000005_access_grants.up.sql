CREATE TABLE access_grants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    subject_type text NOT NULL DEFAULT 'user' CHECK (subject_type IN ('user')),
    subject_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES roles (id),
    scope_type text NOT NULL CHECK (scope_type IN ('workspace', 'project', 'site', 'device', 'dataset')),
    scope_id uuid NOT NULL,
    expires_at timestamptz,
    allow_reshare boolean NOT NULL DEFAULT false,
    allow_api_access boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users (id),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX access_grants_subject_active_idx
    ON access_grants (subject_type, subject_id, workspace_id, scope_type, scope_id)
    WHERE status = 'active';

CREATE INDEX access_grants_workspace_idx
    ON access_grants (workspace_id, created_at DESC);

CREATE UNIQUE INDEX access_grants_active_unique
    ON access_grants (workspace_id, subject_type, subject_id, role_id, scope_type, scope_id)
    WHERE status = 'active';

CREATE TABLE invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    invitee_email text,
    invitee_phone text,
    role_id uuid NOT NULL REFERENCES roles (id),
    scope_type text NOT NULL CHECK (scope_type IN ('workspace', 'project', 'site', 'device', 'dataset')),
    scope_id uuid NOT NULL,
    expires_at timestamptz,
    invited_by uuid NOT NULL REFERENCES users (id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (NULLIF(btrim(invitee_email), '') IS NOT NULL AND NULLIF(btrim(invitee_phone), '') IS NULL)
        OR
        (NULLIF(btrim(invitee_email), '') IS NULL AND NULLIF(btrim(invitee_phone), '') IS NOT NULL)
    ),
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX invitations_workspace_idx
    ON invitations (workspace_id, created_at DESC);

CREATE INDEX invitations_invitee_email_pending_idx
    ON invitations (invitee_email)
    WHERE status = 'pending' AND invitee_email IS NOT NULL;

CREATE INDEX invitations_invitee_phone_pending_idx
    ON invitations (invitee_phone)
    WHERE status = 'pending' AND invitee_phone IS NOT NULL;
