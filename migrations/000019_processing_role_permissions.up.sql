INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'processing.view'
WHERE r.workspace_id IS NULL
  AND r.code IN ('owner', 'admin', 'project_manager', 'site_operator', 'data_manager', 'researcher', 'viewer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'processing.manage'
WHERE r.workspace_id IS NULL
  AND r.code IN ('owner', 'admin', 'project_manager', 'data_manager', 'researcher')
ON CONFLICT DO NOTHING;

INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT wm.id, rp.permission_id
FROM workspace_members wm
JOIN role_permissions rp ON rp.role_id = wm.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('processing.view', 'processing.manage')
ON CONFLICT DO NOTHING;
