INSERT INTO permissions (code, name, resource_type, action)
VALUES
    ('wallboard.view', '查看大屏展示', 'wallboard', 'view'),
    ('wallboard.manage', '管理大屏展示', 'wallboard', 'manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'wallboard.view'
WHERE r.workspace_id IS NULL AND r.code IN ('owner', 'admin', 'project_manager', 'site_operator', 'data_manager', 'researcher', 'viewer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = 'wallboard.manage'
WHERE r.workspace_id IS NULL AND r.code IN ('owner', 'admin', 'project_manager', 'data_manager', 'researcher')
ON CONFLICT DO NOTHING;

INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT wm.id, rp.permission_id FROM workspace_members wm JOIN role_permissions rp ON rp.role_id = wm.role_id
JOIN permissions p ON p.id = rp.permission_id WHERE p.code IN ('wallboard.view', 'wallboard.manage')
ON CONFLICT DO NOTHING;

CREATE TABLE wallboard_templates (
    code varchar(64) PRIMARY KEY,
    current_version integer NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'unpublished')),
    tier varchar(16) NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'premium')),
    display_price varchar(64) NOT NULL DEFAULT '',
    contact_copy varchar(255) NOT NULL DEFAULT '联系管理员开通',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallboard_template_versions (
    template_code varchar(64) NOT NULL REFERENCES wallboard_templates(code),
    version integer NOT NULL,
    manifest_json jsonb NOT NULL,
    config_schema_json jsonb NOT NULL,
    sample_data_json jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (template_code, version)
);

CREATE TABLE wallboards (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name varchar(128) NOT NULL,
    template_code varchar(64) NOT NULL,
    template_version integer NOT NULL,
    config_json jsonb NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (template_code, template_version) REFERENCES wallboard_template_versions(template_code, version)
);

CREATE INDEX wallboards_workspace_idx ON wallboards(workspace_id, status, updated_at DESC);
