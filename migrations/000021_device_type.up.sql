ALTER TABLE devices
    ADD COLUMN device_type text NOT NULL DEFAULT 'standalone' CHECK (
        device_type IN ('standalone', 'gateway', 'gateway_node')
    );

UPDATE devices AS d
SET device_type = CASE
        WHEN EXISTS (
            SELECT 1
            FROM device_relations AS child_rel
            WHERE child_rel.parent_device_id = d.id
              AND child_rel.relation_type = 'gateway_node'
              AND child_rel.status = 'active'
        ) THEN 'gateway'
        WHEN EXISTS (
            SELECT 1
            FROM device_relations AS parent_rel
            WHERE parent_rel.child_device_id = d.id
              AND parent_rel.relation_type = 'gateway_node'
              AND parent_rel.status = 'active'
        ) THEN 'gateway_node'
        ELSE 'standalone'
    END;
