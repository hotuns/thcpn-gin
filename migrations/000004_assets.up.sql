CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name text NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX projects_workspace_active_name_unique
    ON projects (workspace_id, lower(name))
    WHERE status = 'active';

CREATE TABLE sites (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    location_text text,
    latitude double precision CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    longitude double precision CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    UNIQUE (id, project_id, workspace_id),
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX sites_project_active_name_unique
    ON sites (project_id, lower(name))
    WHERE status = 'active';

CREATE TABLE devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    project_id uuid,
    site_id uuid,
    product_id text,
    serial_no text NOT NULL,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'retired')),
    activated_at timestamptz,
    bound_by uuid REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, workspace_id),
    CHECK (site_id IS NULL OR project_id IS NOT NULL),
    FOREIGN KEY (project_id, workspace_id) REFERENCES projects (id, workspace_id),
    FOREIGN KEY (site_id, project_id, workspace_id) REFERENCES sites (id, project_id, workspace_id)
);

CREATE UNIQUE INDEX devices_serial_no_unique ON devices (serial_no);

CREATE TABLE device_capabilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
    capability_code text NOT NULL CHECK (
        capability_code IN (
            'telemetry',
            'image_capture',
            'video_stream',
            'ptz_control',
            'remote_command',
            'configurable',
            'calibratable',
            'firmware_update',
            'edge_storage'
        )
    ),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, capability_code)
);

CREATE TABLE data_streams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    device_id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL CHECK (type IN ('telemetry', 'image', 'video', 'audio', 'event', 'log')),
    unit text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'archived')),
    created_by uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (device_id, code),
    FOREIGN KEY (device_id, workspace_id) REFERENCES devices (id, workspace_id) ON DELETE CASCADE
);
