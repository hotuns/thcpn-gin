ALTER TABLE system_settings ADD COLUMN public_base_url text;
ALTER TABLE system_settings_history ADD COLUMN before_public_base_url text;
ALTER TABLE system_settings_history ADD COLUMN after_public_base_url text;
