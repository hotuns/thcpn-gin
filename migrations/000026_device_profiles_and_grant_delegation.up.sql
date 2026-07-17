ALTER TABLE access_grants
    ADD COLUMN parent_grant_id uuid REFERENCES access_grants (id) ON DELETE SET NULL;

CREATE INDEX access_grants_parent_idx
    ON access_grants (parent_grant_id, status)
    WHERE parent_grant_id IS NOT NULL;

ALTER TABLE invitations
    ADD COLUMN parent_grant_id uuid REFERENCES access_grants (id) ON DELETE SET NULL;

CREATE TABLE device_profiles (
    device_id uuid PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
    description text,
    location_text text,
    latitude double precision CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    longitude double precision CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
    updated_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((latitude IS NULL) = (longitude IS NULL))
);

CREATE TABLE device_profile_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    object_key text NOT NULL UNIQUE,
    original_filename text NOT NULL,
    content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
    width integer CHECK (width IS NULL OR width > 0),
    height integer CHECK (height IS NULL OR height > 0),
    caption text,
    sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_cover boolean NOT NULL DEFAULT false,
    uploaded_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_profile_images_device_order_idx
    ON device_profile_images (device_id, sort_order, created_at, id);

CREATE UNIQUE INDEX device_profile_images_cover_unique
    ON device_profile_images (device_id)
    WHERE is_cover = true;
