package dashboard

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/device"
)

type repository interface {
	Devices(context.Context, auth.Actor, uuid.UUID) ([]device.Device, error)
	Revisions(context.Context, []uuid.UUID) (map[uuid.UUID]string, error)
	ActiveAlerts(context.Context, uuid.UUID, []uuid.UUID) (int64, error)
}

type postgresRepository struct {
	db      *pgxpool.Pool
	devices *device.Service
}

func (r postgresRepository) Devices(ctx context.Context, actor auth.Actor, workspaceID uuid.UUID) ([]device.Device, error) {
	if !actor.IsDemo {
		return r.devices.List(ctx, device.ListInput{WorkspaceID: workspaceID})
	}
	items, err := r.devices.ListDemoShowcase(ctx, actor.UserID, nil, nil)
	if err != nil {
		return nil, err
	}
	filtered := make([]device.Device, 0, len(items))
	for _, item := range items {
		if item.WorkspaceID != nil && *item.WorkspaceID == workspaceID {
			filtered = append(filtered, item)
		}
	}
	return filtered, nil
}

func (r postgresRepository) Revisions(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	result := make(map[uuid.UUID]string, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	// Include parent observation cutoffs and stream configurations: changing a
	// formal-observation boundary or rebinding a source must not reuse old counts.
	rows, err := r.db.Query(ctx, `SELECT d.id,md5(jsonb_build_object(
		'device',jsonb_build_array(d.device_type,d.updated_at),
		'refs',(SELECT jsonb_agg(jsonb_build_array(r.data_source_id,r.adapter_code,r.external_key,r.status,s.updated_at,s.status) ORDER BY r.id)
			FROM device_source_refs r JOIN data_sources s ON s.id=r.data_source_id WHERE r.device_id=d.id),
		'bindings',(SELECT jsonb_agg(jsonb_build_array(ds.id,ds.status,b.adapter_config_json,b.status,b.data_source_id,s.updated_at,s.status) ORDER BY ds.id,b.id)
			FROM data_streams ds LEFT JOIN data_stream_bindings b ON b.data_stream_id=ds.id LEFT JOIN data_sources s ON s.id=b.data_source_id WHERE ds.device_id=d.id),
		'parents',(SELECT jsonb_agg(parent_device_id ORDER BY parent_device_id) FROM device_relations WHERE child_device_id=d.id AND status='active'),
		'nodes',(SELECT jsonb_agg(jsonb_build_array(id,node_index) ORDER BY id) FROM lorawan_physical_nodes WHERE gateway_device_id=d.id),
		'starts',(SELECT jsonb_agg(jsonb_build_array(o.device_id,o.node_index,o.starts_at) ORDER BY o.device_id,o.node_index)
			FROM device_observation_starts o WHERE o.device_id=d.id OR o.device_id IN (SELECT parent_device_id FROM device_relations WHERE child_device_id=d.id AND status='active'))
	)::text) FROM devices d WHERE d.id=ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var version string
		if err := rows.Scan(&id, &version); err != nil {
			return nil, err
		}
		result[id] = id.String() + ":" + version
	}
	return result, rows.Err()
}

func (r postgresRepository) ActiveAlerts(ctx context.Context, workspaceID uuid.UUID, ids []uuid.UUID) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var count int64
	err := r.db.QueryRow(ctx, `SELECT count(*) FROM alert_events WHERE workspace_id=$1 AND device_id=ANY($2::uuid[]) AND resolved_at IS NULL`, workspaceID, ids).Scan(&count)
	return count, err
}
