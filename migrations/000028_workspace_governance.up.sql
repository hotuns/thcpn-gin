ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_type_check;

ALTER TABLE audit_logs
    ADD COLUMN actor_admin_id uuid REFERENCES system_admins (id) ON DELETE SET NULL,
    ADD CONSTRAINT audit_logs_actor_type_check
        CHECK (actor_type IN ('user', 'system_admin', 'service_account', 'system', 'anonymous'));

CREATE INDEX audit_logs_admin_created_idx
    ON audit_logs (actor_admin_id, created_at DESC)
    WHERE actor_admin_id IS NOT NULL;

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
