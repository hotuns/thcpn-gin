CREATE TABLE workspace_admin_interventions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    admin_id uuid NOT NULL REFERENCES system_admins (id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (length(btrim(reason)) >= 5),
    expires_at timestamptz NOT NULL,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX workspace_admin_interventions_active_idx
    ON workspace_admin_interventions (workspace_id, admin_id, expires_at DESC)
    WHERE ended_at IS NULL;
