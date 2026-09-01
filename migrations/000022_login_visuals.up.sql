CREATE TABLE login_visuals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    object_key text NOT NULL UNIQUE,
    original_filename text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

