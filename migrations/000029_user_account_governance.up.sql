ALTER TABLE users
    ADD COLUMN auth_version integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT users_auth_version_check CHECK (auth_version >= 0);

ALTER TABLE user_credentials
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE auth_password_change_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);

CREATE INDEX auth_password_change_sessions_user_idx
    ON auth_password_change_sessions (user_id, expires_at DESC);

CREATE INDEX auth_password_change_sessions_active_idx
    ON auth_password_change_sessions (token_hash, expires_at)
    WHERE used_at IS NULL;
