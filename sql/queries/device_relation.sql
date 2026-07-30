-- name: UpsertDeviceRelation :one
WITH updated_by_external AS (
    UPDATE device_relations AS dr
    SET parent_device_id = $1,
        child_device_id = $2,
        status = 'active',
        synced_at = now(),
        updated_at = now()
    WHERE dr.data_source_id = $4
      AND dr.relation_type = $3
      AND dr.external_parent_device_id = $5
      AND dr.external_child_device_id = $6
    RETURNING dr.id, dr.parent_device_id, dr.child_device_id, dr.relation_type, dr.data_source_id, dr.external_parent_device_id, dr.external_child_device_id, dr.status, dr.synced_at, dr.created_at, dr.updated_at
),
updated_by_devices AS (
    UPDATE device_relations AS dr
    SET data_source_id = $4,
        external_parent_device_id = $5,
        external_child_device_id = $6,
        status = 'active',
        synced_at = now(),
        updated_at = now()
    WHERE dr.parent_device_id = $1
      AND dr.child_device_id = $2
      AND dr.relation_type = $3
      AND NOT EXISTS (SELECT 1 FROM updated_by_external)
    RETURNING dr.id, dr.parent_device_id, dr.child_device_id, dr.relation_type, dr.data_source_id, dr.external_parent_device_id, dr.external_child_device_id, dr.status, dr.synced_at, dr.created_at, dr.updated_at
),
inserted AS (
    INSERT INTO device_relations (
        parent_device_id,
        child_device_id,
        relation_type,
        data_source_id,
        external_parent_device_id,
        external_child_device_id,
        status,
        synced_at
    )
    SELECT $1, $2, $3, $4, $5, $6, 'active', now()
    WHERE NOT EXISTS (SELECT 1 FROM updated_by_external)
      AND NOT EXISTS (SELECT 1 FROM updated_by_devices)
    RETURNING id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
)
SELECT id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
FROM updated_by_external
UNION ALL
SELECT id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
FROM updated_by_devices
UNION ALL
SELECT id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
FROM inserted;

-- name: ListDeviceRelationsByParent :many
SELECT id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
FROM device_relations
WHERE parent_device_id = $1
  AND relation_type = $2
  AND status = 'active'
ORDER BY synced_at DESC, id DESC;

-- name: ListDeviceRelationsByChild :many
SELECT id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at
FROM device_relations
WHERE child_device_id = $1
  AND relation_type = $2
  AND status = 'active'
ORDER BY synced_at DESC, id DESC;

-- name: ListActiveDeviceChildren :many
SELECT
    dr.id,
    dr.parent_device_id,
    dr.child_device_id,
    dr.relation_type,
    dr.data_source_id,
    dr.external_parent_device_id,
    dr.external_child_device_id,
    dr.status,
    dr.synced_at,
    dr.created_at,
    dr.updated_at,
    d.id AS device_id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status AS device_status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at AS device_created_at,
    d.updated_at AS device_updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at
FROM device_relations AS dr
JOIN devices AS d ON d.id = dr.child_device_id
LEFT JOIN device_assignments AS da ON da.device_id = d.id AND da.status = 'active'
WHERE dr.parent_device_id = $1
  AND dr.relation_type = 'gateway_node'
  AND dr.status = 'active'
ORDER BY d.name ASC, d.serial_no ASC, dr.id ASC;

-- name: ListVisibleDeviceChildren :many
SELECT
    dr.id,
    dr.parent_device_id,
    dr.child_device_id,
    dr.relation_type,
    dr.data_source_id,
    dr.external_parent_device_id,
    dr.external_child_device_id,
    dr.status,
    dr.synced_at,
    dr.created_at,
    dr.updated_at,
    d.id AS device_id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status AS device_status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at AS device_created_at,
    d.updated_at AS device_updated_at,
    parent_da.id AS assignment_id,
    parent_da.workspace_id,
    parent_da.project_id,
    parent_da.site_id,
    parent_da.assigned_by,
    parent_da.assigned_at
FROM device_relations AS dr
JOIN devices AS d ON d.id = dr.child_device_id
JOIN device_assignments AS parent_da ON parent_da.device_id = dr.parent_device_id
    AND parent_da.status = 'active'
WHERE dr.parent_device_id = $1
  AND dr.relation_type = 'gateway_node'
  AND dr.status = 'active'
ORDER BY d.name ASC, d.serial_no ASC, dr.id ASC;

-- name: MarkMissingDeviceRelationsRemoved :many
UPDATE device_relations
SET status = 'removed',
    updated_at = now()
WHERE data_source_id = $1
  AND relation_type = 'gateway_node'
  AND external_parent_device_id = $2
  AND status = 'active'
  AND NOT (external_child_device_id = ANY(sqlc.arg(active_child_ids)::bigint[]))
RETURNING id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at;

-- name: MarkDeviceRelationRemovedByDevices :one
UPDATE device_relations
SET status = 'removed',
    updated_at = now()
WHERE parent_device_id = $1
  AND child_device_id = $2
  AND relation_type = 'gateway_node'
  AND status = 'active'
RETURNING id, parent_device_id, child_device_id, relation_type, data_source_id, external_parent_device_id, external_child_device_id, status, synced_at, created_at, updated_at;
