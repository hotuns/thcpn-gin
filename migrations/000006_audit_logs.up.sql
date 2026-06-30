CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces (id) ON DELETE SET NULL,
    actor_type text NOT NULL CHECK (actor_type IN ('user', 'service_account', 'system', 'anonymous')),
    actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    result text NOT NULL CHECK (result IN ('success', 'failure')),
    reason text,
    ip text,
    user_agent text,
    request_id text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_workspace_created_idx
    ON audit_logs (workspace_id, created_at DESC);

CREATE INDEX audit_logs_actor_created_idx
    ON audit_logs (actor_type, actor_id, created_at DESC);

CREATE INDEX audit_logs_resource_created_idx
    ON audit_logs (resource_type, resource_id, created_at DESC);
