ALTER TABLE users ADD COLUMN is_system_admin boolean NOT NULL DEFAULT false;

UPDATE users u
SET is_system_admin = true
FROM system_admins a
WHERE lower(trim(u.email)) = a.email;

DROP TABLE IF EXISTS system_admin_refresh_sessions;
DROP TABLE IF EXISTS system_admins;
