DELETE FROM workspace_member_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE code IN ('processing.view', 'processing.manage')
);
