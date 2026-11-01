// Package observation defines the boundary between commissioning and formal observations.
package observation

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"thcpn-gin/internal/apperr"
	"time"
)

type phaseKey struct{}

const (
	All     = "all"
	Formal  = "formal"
	Testing = "testing"
)

func WithPhase(ctx context.Context, phase string) context.Context {
	return context.WithValue(ctx, phaseKey{}, phase)
}
func Phase(ctx context.Context) string {
	if p, ok := ctx.Value(phaseKey{}).(string); ok {
		return p
	}
	return Formal
}
func Clip(phase string, cutoff *time.Time, start, end time.Time) (time.Time, time.Time, bool) {
	if phase == All {
		return start, end, end.After(start)
	}
	if cutoff == nil {
		return start, end, phase != Testing && end.After(start)
	}
	if phase == Testing {
		boundary := cutoff.Add(-time.Nanosecond)
		if boundary.Before(end) {
			end = boundary
		}
	} else if cutoff.After(start) {
		start = *cutoff
	}
	return start, end, end.After(start)
}

type Service struct{ DB *pgxpool.Pool }
type Start struct {
	NodeIndex int       `json:"node_index"`
	StartsAt  time.Time `json:"starts_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
type Event struct {
	NodeIndex int        `json:"node_index"`
	Previous  *time.Time `json:"previous_start"`
	StartsAt  *time.Time `json:"starts_at"`
	Reason    string     `json:"reason"`
	Actor     string     `json:"actor"`
	CreatedAt time.Time  `json:"created_at"`
}

func (s Service) DeviceStart(ctx context.Context, id uuid.UUID, node int) (*time.Time, error) {
	var cutoff *time.Time
	err := s.DB.QueryRow(ctx, `SELECT COALESCE(n.starts_at,d.starts_at,p.starts_at) FROM devices asset
 LEFT JOIN device_observation_starts n ON n.device_id=asset.id AND n.node_index=$2 AND $2>0
 LEFT JOIN device_observation_starts d ON d.device_id=asset.id AND d.node_index=0
 LEFT JOIN device_relations r ON r.child_device_id=asset.id AND r.status='active'
 LEFT JOIN device_observation_starts p ON p.device_id=r.parent_device_id AND p.node_index=0 WHERE asset.id=$1 LIMIT 1`, id, node).Scan(&cutoff)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return cutoff, err
}
func (s Service) StreamWindow(ctx context.Context, stream uuid.UUID, start, end time.Time) (time.Time, time.Time, bool, error) {
	if Phase(ctx) == All {
		return start, end, true, nil
	}
	var device uuid.UUID
	var node int
	err := s.DB.QueryRow(ctx, `SELECT ds.device_id,COALESCE((b.adapter_config_json->>'node_index')::integer,0) FROM data_streams ds
 LEFT JOIN data_stream_bindings b ON b.data_stream_id=ds.id AND b.status='active' WHERE ds.id=$1 LIMIT 1`, stream).Scan(&device, &node)
	if errors.Is(err, pgx.ErrNoRows) {
		return start, end, true, nil
	}
	if err != nil {
		return start, end, false, err
	}
	return s.DeviceWindow(ctx, device, node, start, end)
}
func (s Service) DeviceWindow(ctx context.Context, id uuid.UUID, node int, start, end time.Time) (time.Time, time.Time, bool, error) {
	if Phase(ctx) == All {
		return start, end, true, nil
	}
	cutoff, err := s.DeviceStart(ctx, id, node)
	if err != nil {
		return start, end, false, err
	}
	start, end, ok := Clip(Phase(ctx), cutoff, start, end)
	return start, end, ok, nil
}
func (s Service) Set(ctx context.Context, id, actor uuid.UUID, node int, at *time.Time, reason string) error {
	if node < 0 {
		return apperr.New(apperr.KindInvalidArgument, "invalid node index")
	}
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var kind string
	if err = tx.QueryRow(ctx, "SELECT device_type FROM devices WHERE id=$1 FOR UPDATE", id).Scan(&kind); err != nil {
		return err
	}
	if node > 0 && kind != "gateway" && kind != "carbon_sink" {
		return apperr.New(apperr.KindInvalidArgument, "独立节点设备请设置设备自身的起始时间")
	}
	if err := SetTx(ctx, tx, id, actor, node, at, reason); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func SetTx(ctx context.Context, tx pgx.Tx, id, actor uuid.UUID, node int, at *time.Time, reason string) error {
	var err error
	var old *time.Time
	err = tx.QueryRow(ctx, "SELECT starts_at FROM device_observation_starts WHERE device_id=$1 AND node_index=$2", id, node).Scan(&old)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if at == nil {
		_, err = tx.Exec(ctx, "DELETE FROM device_observation_starts WHERE device_id=$1 AND node_index=$2", id, node)
	} else {
		_, err = tx.Exec(ctx, `INSERT INTO device_observation_starts(device_id,node_index,starts_at,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(device_id,node_index) DO UPDATE SET starts_at=$3,updated_by=$4,updated_at=now()`, id, node, *at, actor)
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, "INSERT INTO device_observation_start_events(device_id,node_index,previous_start,starts_at,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)", id, node, old, at, reason, actor)
	if err != nil {
		return err
	}
	return nil
}
func (s Service) List(ctx context.Context, id uuid.UUID, history bool) ([]Start, []Event, error) {
	starts := []Start{}
	events := []Event{}
	rows, err := s.DB.Query(ctx, "SELECT node_index,starts_at,updated_at FROM device_observation_starts WHERE device_id=$1 ORDER BY node_index", id)
	if err != nil {
		return nil, nil, err
	}
	for rows.Next() {
		var item Start
		if err = rows.Scan(&item.NodeIndex, &item.StartsAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return nil, nil, err
		}
		starts = append(starts, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, nil, err
	}
	if !history {
		return starts, events, nil
	}
	rows, err = s.DB.Query(ctx, `SELECT e.node_index,e.previous_start,e.starts_at,e.reason,a.name,e.created_at FROM device_observation_start_events e JOIN system_admins a ON a.id=e.actor_id WHERE device_id=$1 ORDER BY e.created_at DESC LIMIT 100`, id)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item Event
		if err = rows.Scan(&item.NodeIndex, &item.Previous, &item.StartsAt, &item.Reason, &item.Actor, &item.CreatedAt); err != nil {
			return nil, nil, err
		}
		events = append(events, item)
	}
	return starts, events, rows.Err()
}
func HasPhase(ctx context.Context) bool { _, ok := ctx.Value(phaseKey{}).(string); return ok }
func AdminContext(ctx context.Context) context.Context {
	if HasPhase(ctx) {
		return ctx
	}
	return WithPhase(ctx, All)
}
