DROP TABLE IF EXISTS lorawan_v2_node_config_snapshots;
DROP TABLE IF EXISTS sensor_template_variants;
ALTER TABLE sensor_templates DROP COLUMN IF EXISTS metrics;
