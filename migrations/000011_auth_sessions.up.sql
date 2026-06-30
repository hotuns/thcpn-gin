CREATE TABLE auth_refresh_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
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

CREATE INDEX auth_refresh_sessions_user_id_idx
    ON auth_refresh_sessions (user_id);

CREATE INDEX auth_refresh_sessions_active_idx
    ON auth_refresh_sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE auth_access_token_blacklist (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_access_token_blacklist_expires_at_idx
    ON auth_access_token_blacklist (expires_at);
