CREATE TABLE system_admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    email text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    failed_attempts integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE system_admin_refresh_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id uuid NOT NULL REFERENCES system_admins (id) ON DELETE CASCADE,
    refresh_token_hash text NOT NULL UNIQUE,
    user_agent text,
    client_ip text,
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX system_admin_refresh_sessions_admin_id_idx
    ON system_admin_refresh_sessions (admin_id);

CREATE INDEX system_admin_refresh_sessions_active_idx
    ON system_admin_refresh_sessions (admin_id, expires_at)
    WHERE revoked_at IS NULL;

-- Preserve administrators created by the previous user-table based model.
INSERT INTO system_admins (name, email, password_hash, status, last_login_at, created_at, updated_at)
SELECT u.name, lower(trim(u.email)), c.password_hash, u.status, u.last_login_at, u.created_at, u.updated_at
FROM users u
JOIN user_credentials c ON c.user_id = u.id
WHERE u.is_system_admin = true
  AND NULLIF(trim(u.email), '') IS NOT NULL
ON CONFLICT (email) DO NOTHING;

ALTER TABLE users DROP COLUMN is_system_admin;
