-- Keep V1 identities stable; give each existing V2 definition its own template.
DO $$
DECLARE
  source_id bigint;
  v2_id bigint;
BEGIN
  FOR source_id IN
    SELECT template_id FROM sensor_template_variants
    GROUP BY template_id HAVING count(*) > 1
  LOOP
    INSERT INTO sensor_templates
      (sensor_type, description, port_nums, params, metrics, status, created_by, updated_by, created_at, updated_at)
    SELECT sensor_type, description, '[]'::jsonb,
      jsonb_build_object('contents', metrics), metrics, status, created_by, updated_by, created_at, updated_at
    FROM sensor_templates WHERE id = source_id RETURNING id INTO v2_id;

    UPDATE sensor_template_variants SET template_id = v2_id
    WHERE template_id = source_id AND source_family = 'lorawan_v2';

    UPDATE lorawan_v2_node_config_snapshots s
    SET template_instances = (
      SELECT jsonb_agg(CASE WHEN instance->>'template_id' = source_id::text
        THEN jsonb_set(instance, '{template_id}', to_jsonb(v2_id)) ELSE instance END ORDER BY position)
      FROM jsonb_array_elements(s.template_instances) WITH ORDINALITY AS entries(instance, position)
    )
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(s.template_instances) instance
      WHERE instance->>'template_id' = source_id::text);
  END LOOP;
END $$;

ALTER TABLE sensor_template_variants ADD CONSTRAINT sensor_template_single_family UNIQUE (template_id);
COMMENT ON TABLE sensor_template_variants IS 'Exclusive template protocol: thcpn = V1, lorawan_v2 = V2. Versions have independent template identities.';
