-- Restoring the earlier schema requires names to fit its former field lengths.
ALTER TABLE node_profiles ALTER COLUMN name TYPE varchar(50);
ALTER TABLE processing_tasks ALTER COLUMN name TYPE varchar(128);
ALTER TABLE wallboards ALTER COLUMN name TYPE varchar(128);
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_name_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120);
ALTER TABLE workspace_api_keys DROP CONSTRAINT workspace_api_keys_name_check;
ALTER TABLE workspace_api_keys ADD CONSTRAINT workspace_api_keys_name_check CHECK (length(name) BETWEEN 1 AND 100);
DROP TABLE system_settings_history;
DROP TABLE system_settings;
