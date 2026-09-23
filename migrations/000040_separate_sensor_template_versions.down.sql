-- Retain independent templates and their references to avoid losing later edits.
ALTER TABLE sensor_template_variants DROP CONSTRAINT sensor_template_single_family;
COMMENT ON TABLE sensor_template_variants IS 'Protocol-specific configuration for a shared sensor template.';
