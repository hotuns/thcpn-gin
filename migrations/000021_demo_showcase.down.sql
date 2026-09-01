DROP TABLE IF EXISTS demo_showcase_devices;
DROP INDEX IF EXISTS workspaces_single_demo_workspace;
ALTER TABLE workspaces DROP COLUMN IF EXISTS is_demo_workspace;
DROP INDEX IF EXISTS users_single_demo_account;
ALTER TABLE users DROP COLUMN IF EXISTS is_demo;
