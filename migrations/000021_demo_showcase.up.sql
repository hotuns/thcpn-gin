ALTER TABLE users ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_single_demo_account ON users (is_demo) WHERE is_demo = true;

ALTER TABLE workspaces ADD COLUMN is_demo_workspace boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX workspaces_single_demo_workspace ON workspaces (is_demo_workspace) WHERE is_demo_workspace = true;

CREATE TABLE demo_showcase_devices (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    device_id uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
    added_by uuid NOT NULL REFERENCES system_admins(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, device_id)
);

CREATE INDEX demo_showcase_devices_user_idx ON demo_showcase_devices (user_id, created_at DESC);
