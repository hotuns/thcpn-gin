DROP TABLE IF EXISTS wallboards;
DROP TABLE IF EXISTS wallboard_template_versions;
DROP TABLE IF EXISTS wallboard_templates;

DELETE FROM workspace_member_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('wallboard.view', 'wallboard.manage'));
DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('wallboard.view', 'wallboard.manage'));
DELETE FROM permissions WHERE code IN ('wallboard.view', 'wallboard.manage');
