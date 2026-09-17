DROP INDEX IF EXISTS users_single_demo_account;
DROP INDEX IF EXISTS workspaces_single_demo_workspace;

ALTER TABLE users ADD COLUMN username text;
UPDATE users
SET username = 'demo-' || left(id::text, 8)
WHERE is_demo = true AND username IS NULL;
CREATE UNIQUE INDEX users_username_unique_ci
    ON users (lower(username)) WHERE username IS NOT NULL;
ALTER TABLE users DROP CONSTRAINT users_check;
ALTER TABLE users ADD CONSTRAINT users_identity_check CHECK (
    (is_demo = true AND NULLIF(btrim(username), '') IS NOT NULL)
    OR
    (is_demo = false AND (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(email), '') IS NOT NULL))
);

ALTER TABLE demo_showcase_devices DROP CONSTRAINT demo_showcase_devices_pkey;
ALTER TABLE demo_showcase_devices DROP CONSTRAINT demo_showcase_devices_user_id_device_id_key;
ALTER TABLE demo_showcase_devices ADD PRIMARY KEY (workspace_id, device_id);
CREATE INDEX demo_showcase_devices_device_idx ON demo_showcase_devices (device_id);

UPDATE export_jobs ej
SET workspace_id = w.id
FROM users u
JOIN workspaces w ON w.owner_user_id = u.id AND w.is_demo_workspace = true
WHERE ej.requested_by = u.id
  AND u.is_demo = true;
