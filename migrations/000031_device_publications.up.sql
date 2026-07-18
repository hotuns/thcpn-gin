CREATE TABLE device_publications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL UNIQUE REFERENCES devices (id) ON DELETE CASCADE,
    public_slug text NOT NULL UNIQUE,
    enabled boolean NOT NULL DEFAULT false,
    password_hash text,
    access_version integer NOT NULL DEFAULT 1,
    created_by uuid NOT NULL REFERENCES users (id),
    updated_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (length(public_slug) >= 20),
    CHECK (access_version > 0)
);

CREATE INDEX device_publications_enabled_idx
    ON device_publications (public_slug)
    WHERE enabled = true;
