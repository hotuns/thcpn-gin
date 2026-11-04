-- name: LockDeviceForDeletion :one
SELECT id, name, serial_no, device_type, lifecycle_status FROM devices WHERE id=$1 FOR UPDATE;

-- name: DeviceDeletionSources :many
SELECT r.data_source_id, r.external_key, r.adapter_code, r.status FROM device_source_refs r WHERE r.device_id=$1;

-- name: DeviceDeletionBlockers :many
WITH asset AS (SELECT sqlc.arg(device_id)::uuid AS id),
     streams AS (SELECT s.id FROM data_streams s, asset a WHERE s.device_id=a.id),
     ids AS (SELECT id FROM asset UNION ALL SELECT id FROM streams)
SELECT blocker FROM (
  SELECT '设备有工作区分配或认领历史'::text AS blocker WHERE EXISTS(SELECT 1 FROM device_assignments,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM device_claim_requests,asset WHERE device_id=asset.id)
  UNION ALL SELECT '设备有安装或生命周期记录' WHERE EXISTS(SELECT 1 FROM device_installation_records,asset WHERE device_id=asset.id AND (installed_on IS NOT NULL OR retired_on IS NOT NULL OR installer_id IS NOT NULL)) OR EXISTS(SELECT 1 FROM device_lifecycle_events,asset WHERE device_id=asset.id AND to_status <> 'inbound')
  UNION ALL SELECT '设备有节点或网关关系' WHERE EXISTS(SELECT 1 FROM device_relations,asset WHERE parent_device_id=asset.id OR child_device_id=asset.id) OR EXISTS(SELECT 1 FROM lorawan_physical_nodes,asset WHERE gateway_device_id=asset.id) OR EXISTS(SELECT 1 FROM node_profiles,asset WHERE device_id=asset.id)
  UNION ALL SELECT '设备有业务配置或运维记录' WHERE EXISTS(SELECT 1 FROM source_operations,asset WHERE device_id=asset.id AND kind='config_update') OR EXISTS(SELECT 1 FROM device_operations,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM firmware_release_targets,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM device_observation_start_events,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM device_observation_starts,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM lorawan_gateway_details,asset WHERE device_id=asset.id AND (app_key<>'' OR eui<>'' OR wifi_name<>'')) OR EXISTS(SELECT 1 FROM computed_data_streams WHERE data_stream_id IN (SELECT id FROM streams)) OR EXISTS(SELECT 1 FROM processing_task_inputs WHERE source_type='data_stream' AND source_id IN (SELECT id FROM streams)) OR EXISTS(SELECT 1 FROM lorawan_v2_node_config_snapshots,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM device_config_snapshots,asset WHERE device_id=asset.id AND (data_json<>'[]'::jsonb OR image_json<>'[]'::jsonb OR control_json<>'{}'::jsonb))
  UNION ALL SELECT '设备有关联数据集、授权或分享' WHERE EXISTS(SELECT 1 FROM dataset_sources WHERE source_type IN ('device','data_stream') AND source_id IN (SELECT id FROM ids)) OR EXISTS(SELECT 1 FROM access_grants WHERE scope_type IN ('device','data_stream') AND scope_id IN (SELECT id FROM ids)) OR EXISTS(SELECT 1 FROM invitations WHERE scope_type IN ('device','data_stream') AND scope_id IN (SELECT id FROM ids)) OR EXISTS(SELECT 1 FROM device_publications,asset WHERE device_id=asset.id) OR EXISTS(SELECT 1 FROM demo_showcase_devices,asset WHERE device_id=asset.id)
  UNION ALL SELECT '设备有关联预警' WHERE EXISTS(SELECT 1 FROM alert_rules WHERE device_id IN (SELECT id FROM asset) OR data_stream_id IN (SELECT id FROM streams)) OR EXISTS(SELECT 1 FROM alert_events WHERE device_id IN (SELECT id FROM asset) OR data_stream_id IN (SELECT id FROM streams))
  UNION ALL SELECT '设备有关联导出或一张图' WHERE EXISTS(SELECT 1 FROM export_jobs WHERE resource_id IN (SELECT id FROM ids) OR EXISTS(SELECT 1 FROM ids WHERE strpos(request_config_json::text,ids.id::text)>0)) OR EXISTS(SELECT 1 FROM wallboards WHERE EXISTS(SELECT 1 FROM ids WHERE strpos(config_json::text,ids.id::text)>0))
  UNION ALL SELECT '设备已有预览或安装照片' WHERE EXISTS(SELECT 1 FROM audit_logs,asset WHERE resource_id=asset.id AND action='camera.live_session.create' AND result='success') OR EXISTS(SELECT 1 FROM device_profile_images,asset WHERE device_id=asset.id)
  UNION ALL SELECT '设备有工作区资料' WHERE EXISTS(SELECT 1 FROM device_workspace_tags,asset WHERE device_id=asset.id)
) AS reasons;

-- name: RemoveUnusedDeviceInstallation :exec
DELETE FROM device_installation_records WHERE device_id=$1;

-- name: RemoveUnusedGatewayDetails :exec
DELETE FROM lorawan_gateway_details WHERE device_id=$1;

-- name: DeleteUnusedDevice :execrows
DELETE FROM devices WHERE id=$1;

-- name: DeletionOperationForAsset :one
SELECT id, status, request FROM source_operations WHERE data_source_id=$1 AND kind='device_delete' AND request->>'asset'=sqlc.arg(asset)::text AND status IN ('running','partial','unknown') ORDER BY created_at DESC LIMIT 1;

-- name: DeleteUnusedPhysicalNodeProjection :exec
DELETE FROM lorawan_physical_nodes WHERE data_source_id=$1 AND external_id=$2 AND sn=$3 AND gateway_device_id IS NULL;

-- name: IsPhysicalNodeProjectedAsBound :one
SELECT EXISTS(SELECT 1 FROM lorawan_physical_nodes WHERE data_source_id=$1 AND external_id=$2 AND gateway_device_id IS NOT NULL);

-- name: CompleteDeviceDeletionOperation :exec
UPDATE source_operations SET status='completed', result='{"source":"deleted","platform":"deleted"}', error='', updated_at=now() WHERE id=$1 AND kind='device_delete';

-- name: ListPendingPhysicalNodeDeletions :many
SELECT request FROM source_operations
WHERE data_source_id=$1 AND kind='device_delete' AND request->>'asset' LIKE 'node:%'
AND status IN ('running','partial','unknown')
ORDER BY created_at DESC;


-- name: DeviceDeletionCameraSN :one
SELECT device_serial FROM camera_bindings WHERE device_id=$1 ORDER BY created_at DESC LIMIT 1;
