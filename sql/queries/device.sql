-- name: CreateDevice :one
INSERT INTO devices (
    product_id,
    serial_no,
    name,
    status,
    activated_at
)
VALUES ($1, $2, $3, 'active', now())
RETURNING id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type;

-- name: GetDevice :one
SELECT id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type
FROM devices
WHERE id = $1;

-- name: UpdateDevice :one
UPDATE devices
SET product_id = $2,
    serial_no = $3,
    name = $4,
    status = $5,
    updated_at = now()
WHERE id = $1
RETURNING id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type;

-- name: UpdateDeviceType :one
UPDATE devices
SET device_type = $2,
    updated_at = now()
WHERE id = $1
RETURNING id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type;

-- name: CreateDeviceAssignment :one
INSERT INTO device_assignments (
    device_id,
    workspace_id,
    project_id,
    site_id,
    assigned_by,
    assigned_by_type
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, device_id, workspace_id, project_id, site_id, status, assigned_by, assigned_at, unassigned_at, created_at, updated_at, assigned_by_type;

-- name: GetActiveDeviceAssignment :one
WITH target AS (
    SELECT d.id FROM devices d WHERE d.id = $1
),
resolved AS (
    SELECT COALESCE(dr.parent_device_id, target.id) AS device_id
    FROM target
    LEFT JOIN device_relations dr
      ON dr.child_device_id = target.id
     AND dr.relation_type = 'gateway_node'
     AND dr.status = 'active'
)
SELECT da.id, da.device_id, da.workspace_id, da.project_id, da.site_id, da.status, da.assigned_by, da.assigned_at, da.unassigned_at, da.created_at, da.updated_at, da.assigned_by_type
FROM resolved
JOIN device_assignments da ON da.device_id = resolved.device_id
WHERE da.status = 'active'
ORDER BY assigned_at DESC, id DESC
LIMIT 1;

-- name: GetActiveDeviceAssignmentByDataStream :one
(
SELECT da.id, da.device_id, da.workspace_id, da.project_id, da.site_id, da.status, da.assigned_by, da.assigned_at, da.unassigned_at, da.created_at, da.updated_at, da.assigned_by_type
FROM device_assignments AS da
JOIN data_streams AS ds ON ds.device_id = da.device_id
WHERE ds.id = $1
  AND da.status = 'active'
)
UNION ALL
(
SELECT da.id, da.device_id, da.workspace_id, da.project_id, da.site_id, da.status, da.assigned_by, da.assigned_at, da.unassigned_at, da.created_at, da.updated_at, da.assigned_by_type
FROM data_streams ds
JOIN device_relations dr
  ON dr.child_device_id = ds.device_id
 AND dr.relation_type = 'gateway_node'
 AND dr.status = 'active'
JOIN device_assignments da
  ON da.device_id = dr.parent_device_id
 AND da.status = 'active'
WHERE ds.id = $1
)
ORDER BY assigned_at DESC, id DESC
LIMIT 1;

-- name: GetDeviceWithActiveAssignment :one
SELECT
    d.id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at,
    d.updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at
FROM devices AS d
JOIN device_assignments AS da
  ON da.device_id = CASE
      WHEN d.device_type = 'gateway_node' THEN (
          SELECT dr.parent_device_id
          FROM device_relations dr
          WHERE dr.child_device_id = d.id
            AND dr.relation_type = 'gateway_node'
            AND dr.status = 'active'
          ORDER BY dr.synced_at DESC, dr.id DESC
          LIMIT 1
      )
      ELSE d.id
  END
 AND da.status = 'active'
WHERE d.id = $1;

-- name: ListSystemDeviceAssets :many
SELECT
    d.id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.created_at,
    d.updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at,
    d.device_type AS topology_role,
    (
        SELECT count(*)::bigint
        FROM device_relations AS child_rel
        WHERE child_rel.parent_device_id = d.id
          AND child_rel.relation_type = 'gateway_node'
          AND child_rel.status = 'active'
    ) AS child_count
FROM devices AS d
LEFT JOIN device_assignments AS da ON da.device_id = d.id AND da.status = 'active'
ORDER BY d.created_at DESC, d.id DESC;

-- name: ListDevicesByWorkspace :many
SELECT
    d.id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at,
    d.updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at,
    d.device_type AS topology_role,
    (
        SELECT count(*)::bigint
        FROM device_relations AS child_rel
        WHERE child_rel.parent_device_id = d.id
          AND child_rel.relation_type = 'gateway_node'
          AND child_rel.status = 'active'
    ) AS child_count
FROM devices AS d
JOIN device_assignments AS da ON da.device_id = d.id AND da.status = 'active'
WHERE da.workspace_id = $1
ORDER BY da.assigned_at DESC, d.created_at DESC, d.id DESC;

-- name: ListDevicesByProject :many
SELECT
    d.id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at,
    d.updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at,
    d.device_type AS topology_role,
    (
        SELECT count(*)::bigint
        FROM device_relations AS child_rel
        WHERE child_rel.parent_device_id = d.id
          AND child_rel.relation_type = 'gateway_node'
          AND child_rel.status = 'active'
    ) AS child_count
FROM devices AS d
JOIN device_assignments AS da ON da.device_id = d.id AND da.status = 'active'
WHERE da.workspace_id = $1
  AND da.project_id = $2
ORDER BY da.assigned_at DESC, d.created_at DESC, d.id DESC;

-- name: ListDevicesBySite :many
SELECT
    d.id,
    d.product_id,
    d.serial_no,
    d.name,
    d.status,
    d.activated_at,
    d.lifecycle_status,
    d.lifecycle_updated_at,
    d.device_type,
    d.created_at,
    d.updated_at,
    da.id AS assignment_id,
    da.workspace_id,
    da.project_id,
    da.site_id,
    da.assigned_by,
    da.assigned_at,
    d.device_type AS topology_role,
    (
        SELECT count(*)::bigint
        FROM device_relations AS child_rel
        WHERE child_rel.parent_device_id = d.id
          AND child_rel.relation_type = 'gateway_node'
          AND child_rel.status = 'active'
    ) AS child_count
FROM devices AS d
JOIN device_assignments AS da ON da.device_id = d.id AND da.status = 'active'
WHERE da.workspace_id = $1
  AND da.site_id = $2
ORDER BY da.assigned_at DESC, d.created_at DESC, d.id DESC;

-- name: UpdateDeviceAssignment :one
UPDATE device_assignments
SET project_id = $2,
    site_id = $3,
    updated_at = now()
WHERE id = $1
  AND status = 'active'
RETURNING id, device_id, workspace_id, project_id, site_id, status, assigned_by, assigned_at, unassigned_at, created_at, updated_at, assigned_by_type;

-- name: CloseActiveDeviceAssignment :one
UPDATE device_assignments
SET status = $2,
    unassigned_at = now(),
    updated_at = now()
WHERE device_id = $1
  AND status = 'active'
RETURNING id, device_id, workspace_id, project_id, site_id, status, assigned_by, assigned_at, unassigned_at, created_at, updated_at, assigned_by_type;

-- name: ListDeviceCapabilities :many
SELECT capability_code
FROM device_capabilities
WHERE device_id = $1
ORDER BY capability_code ASC;

-- name: DeleteDeviceCapabilities :exec
DELETE FROM device_capabilities
WHERE device_id = $1;

-- name: AddDeviceCapability :one
INSERT INTO device_capabilities (device_id, capability_code)
VALUES ($1, $2)
ON CONFLICT (device_id, capability_code) DO NOTHING
RETURNING id, device_id, capability_code, created_at;

-- name: UpdateDeviceLifecycle :one
UPDATE devices
SET lifecycle_status = $2,
    lifecycle_updated_at = $3,
    updated_at = now()
WHERE id = $1
RETURNING id, product_id, serial_no, name, status, activated_at, created_at, updated_at, lifecycle_status, lifecycle_updated_at, device_type;

-- name: CreateDeviceLifecycleEvent :one
INSERT INTO device_lifecycle_events (
    device_id,
    from_status,
    to_status,
    occurred_at,
    note,
    actor_user_id
)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, device_id, from_status, to_status, occurred_at, note, actor_user_id, created_at;

-- name: ListDeviceLifecycleEvents :many
SELECT id, device_id, from_status, to_status, occurred_at, note, actor_user_id, created_at
FROM device_lifecycle_events
WHERE device_id = $1
ORDER BY occurred_at DESC, id DESC;

-- name: CreateDeviceOperation :one
INSERT INTO device_operations (
    workspace_id,
    device_id,
    operation_type,
    request_json,
    requested_by
)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, workspace_id, device_id, operation_type, status, request_json, requested_by, created_at, updated_at;

-- name: ListDeviceOperationsByDevice :many
SELECT id, workspace_id, device_id, operation_type, status, request_json, requested_by, created_at, updated_at
FROM device_operations
WHERE device_id = $1
ORDER BY created_at DESC, id DESC;
