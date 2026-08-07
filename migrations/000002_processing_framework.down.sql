DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE code IN ('processing.view', 'processing.manage'));
DELETE FROM permissions WHERE code IN ('processing.view', 'processing.manage');
DROP TABLE IF EXISTS processing_results;
DROP TABLE IF EXISTS processing_executions;
DROP TABLE IF EXISTS processing_task_inputs;
DROP TABLE IF EXISTS processing_task_versions;
DROP TABLE IF EXISTS processing_tasks;
DROP TABLE IF EXISTS processing_processors;
DELETE FROM device_capabilities WHERE capability_code = 'ndvi_processing';
DELETE FROM device_capability_definitions WHERE code = 'ndvi_processing';
