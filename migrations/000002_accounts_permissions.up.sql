CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    phone text,
    email text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (NULLIF(btrim(phone), '') IS NOT NULL OR NULLIF(btrim(email), '') IS NOT NULL)
);

CREATE UNIQUE INDEX users_phone_unique ON users (phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX users_email_unique ON users (email) WHERE email IS NOT NULL;

CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type text NOT NULL CHECK (type IN ('personal', 'organization')),
    organization_type text CHECK (
        (type = 'personal' AND organization_type IS NULL)
        OR
        (type = 'organization' AND organization_type IS NOT NULL AND organization_type IN ('lab', 'institution', 'company', 'government', 'service_provider', 'other'))
    ),
    name text NOT NULL,
    owner_user_id uuid NOT NULL REFERENCES users (id),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX workspaces_personal_owner_unique ON workspaces (owner_user_id) WHERE type = 'personal';

CREATE TABLE roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    is_system_role boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roles_system_code_unique ON roles (code) WHERE workspace_id IS NULL;
CREATE UNIQUE INDEX roles_workspace_code_unique ON roles (workspace_id, code) WHERE workspace_id IS NOT NULL;

CREATE TABLE permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    resource_type text NOT NULL,
    action text NOT NULL
);

CREATE TABLE role_permissions (
    role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE workspace_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES roles (id),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'removed')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
);

INSERT INTO roles (code, name, is_system_role)
VALUES
    ('owner', 'Owner', true),
    ('admin', 'Admin', true),
    ('project_manager', 'Project Manager', true),
    ('site_operator', 'Site Operator', true),
    ('data_manager', 'Data Manager', true),
    ('researcher', 'Researcher', true),
    ('viewer', 'Viewer', true),
    ('shared_viewer', 'Shared Viewer', true),
    ('shared_downloader', 'Shared Downloader', true),
    ('service_engineer', 'Service Engineer', true)
ON CONFLICT DO NOTHING;

INSERT INTO permissions (code, name, resource_type, action)
VALUES
    ('member.manage', '管理成员', 'member', 'manage'),
    ('workspace.view', '查看工作空间', 'workspace', 'view'),
    ('workspace.manage', '管理工作空间信息', 'workspace', 'manage'),
    ('project.view', '查看项目', 'project', 'view'),
    ('project.manage', '管理项目', 'project', 'manage'),
    ('site.view', '查看站点', 'site', 'view'),
    ('site.manage', '管理站点', 'site', 'manage'),
    ('device.view', '查看设备', 'device', 'view'),
    ('device.bind', '绑定设备', 'device', 'bind'),
    ('device.configure', '修改设备配置', 'device', 'configure'),
    ('device.calibrate', '设备校准', 'device', 'calibrate'),
    ('device.maintain', '设备诊断和维护', 'device', 'maintain'),
    ('device.firmware_upgrade', '固件升级', 'device', 'firmware_upgrade'),
    ('device.unbind', '解绑设备', 'device', 'unbind'),
    ('device.transfer', '转移设备', 'device', 'transfer'),
    ('telemetry.view_realtime', '查看实时数据', 'telemetry', 'view_realtime'),
    ('telemetry.view_history', '查看历史数据', 'telemetry', 'view_history'),
    ('telemetry.export', '导出数据', 'telemetry', 'export'),
    ('media.live_view', '查看实时画面', 'media', 'live_view'),
    ('media.archive_view', '查看历史图片/录像', 'media', 'archive_view'),
    ('media.download', '下载图片/视频', 'media', 'download'),
    ('media.delete', '删除图片/视频', 'media', 'delete'),
    ('media.ptz_control', '云台控制', 'media', 'ptz_control'),
    ('dataset.view', '查看数据集', 'dataset', 'view'),
    ('dataset.create', '创建数据集', 'dataset', 'create'),
    ('dataset.export', '导出数据集', 'dataset', 'export'),
    ('dataset.share', '分享数据集', 'dataset', 'share'),
    ('dataset.delete', '删除数据集', 'dataset', 'delete'),
    ('dataset.lock', '锁定数据集', 'dataset', 'lock'),
    ('share.view', '查看分享记录', 'share', 'view'),
    ('share.create', '创建分享', 'share', 'create'),
    ('share.revoke', '撤销分享', 'share', 'revoke'),
    ('audit.view', '查看审计日志', 'audit', 'view'),
    ('service_access.grant', '授权售后访问', 'service_access', 'grant')
ON CONFLICT (code) DO NOTHING;

WITH role_permission_seed (role_code, permission_codes) AS (
    VALUES
        ('owner', ARRAY[
            'member.manage', 'workspace.view', 'workspace.manage', 'project.view', 'project.manage',
            'site.view', 'site.manage', 'device.view', 'device.bind', 'device.configure',
            'device.calibrate', 'device.maintain', 'device.firmware_upgrade', 'device.unbind',
            'device.transfer', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.delete', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke', 'audit.view', 'service_access.grant'
        ]::text[]),
        ('admin', ARRAY[
            'member.manage', 'workspace.view', 'workspace.manage', 'project.view', 'project.manage',
            'site.view', 'site.manage', 'device.view', 'device.bind', 'device.configure',
            'device.calibrate', 'device.maintain', 'device.firmware_upgrade', 'device.unbind',
            'device.transfer', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.delete', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke', 'audit.view', 'service_access.grant'
        ]::text[]),
        ('project_manager', ARRAY[
            'workspace.view', 'project.view', 'project.manage', 'site.view', 'site.manage',
            'device.view', 'device.bind', 'device.configure', 'device.calibrate', 'device.maintain',
            'device.firmware_upgrade', 'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download', 'media.ptz_control',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.lock',
            'share.view', 'share.create', 'share.revoke', 'service_access.grant'
        ]::text[]),
        ('site_operator', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'site.manage', 'device.view',
            'device.configure', 'device.maintain', 'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'media.ptz_control', 'dataset.view'
        ]::text[]),
        ('data_manager', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download',
            'dataset.view', 'dataset.create', 'dataset.export', 'dataset.share', 'dataset.delete',
            'dataset.lock', 'share.view', 'share.create', 'share.revoke'
        ]::text[]),
        ('researcher', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'dataset.view', 'dataset.export'
        ]::text[]),
        ('viewer', ARRAY[
            'workspace.view', 'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'dataset.view'
        ]::text[]),
        ('shared_viewer', ARRAY[
            'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history',
            'media.live_view', 'media.archive_view', 'dataset.view'
        ]::text[]),
        ('shared_downloader', ARRAY[
            'project.view', 'site.view', 'device.view',
            'telemetry.view_realtime', 'telemetry.view_history', 'telemetry.export',
            'media.live_view', 'media.archive_view', 'media.download',
            'dataset.view', 'dataset.export'
        ]::text[]),
        ('service_engineer', ARRAY[
            'site.view', 'device.view', 'device.configure', 'device.calibrate',
            'device.maintain', 'device.firmware_upgrade', 'telemetry.view_realtime'
        ]::text[])
),
expanded AS (
    SELECT role_code, unnest(permission_codes) AS permission_code
    FROM role_permission_seed
)
INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM expanded
JOIN roles ON roles.code = expanded.role_code AND roles.workspace_id IS NULL
JOIN permissions ON permissions.code = expanded.permission_code
ON CONFLICT DO NOTHING;
