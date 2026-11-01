CREATE TABLE system_settings (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 values_json jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(values_json)='object'),
 version bigint NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES system_admins(id)
);
CREATE TABLE system_settings_history (
 id bigserial PRIMARY KEY,
 actor_admin_id uuid NOT NULL REFERENCES system_admins(id),
 before_json jsonb NOT NULL,
 after_json jsonb NOT NULL,
 reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE node_profiles ALTER COLUMN name TYPE text;
ALTER TABLE processing_tasks ALTER COLUMN name TYPE text;
ALTER TABLE wallboards ALTER COLUMN name TYPE text;
ALTER TABLE alert_rules DROP CONSTRAINT alert_rules_name_check;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_name_check CHECK (length(btrim(name))>=1);
ALTER TABLE workspace_api_keys DROP CONSTRAINT workspace_api_keys_name_check;
ALTER TABLE workspace_api_keys ADD CONSTRAINT workspace_api_keys_name_check CHECK (length(name)>=1);
