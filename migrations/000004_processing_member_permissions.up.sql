INSERT INTO workspace_member_permissions (member_id, permission_id)
SELECT wm.id, rp.permission_id
FROM workspace_members wm
JOIN role_permissions rp ON rp.role_id = wm.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.code IN ('processing.view', 'processing.manage')
ON CONFLICT DO NOTHING;
