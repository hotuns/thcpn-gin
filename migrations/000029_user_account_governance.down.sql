DROP TABLE IF EXISTS auth_password_change_sessions;

ALTER TABLE user_credentials
    DROP COLUMN IF EXISTS must_change_password;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_auth_version_check,
    DROP COLUMN IF EXISTS auth_version;
