CREATE TABLE user_mfa_totp (
    user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    secret_ciphertext bytea NOT NULL,
    secret_nonce bytea NOT NULL,
    enabled_at timestamptz,
    last_used_step bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_mfa_totp_enabled_idx
    ON user_mfa_totp (user_id)
    WHERE enabled_at IS NOT NULL;
