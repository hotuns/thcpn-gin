package thcpn

import (
	"context"
	"encoding/json"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Service) ReconcileConfig(ctx context.Context, deviceID, actorID uuid.UUID) (platform.UpdateDeviceConfigResult, error) {
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, platform.MapNotFoundOrInternal(err, "device configuration source not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	unlock, err := s.LockSourceSync(ctx, source.ID.String()+"/thcpn")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	defer unlock()
	db, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	config, err := readLatestTHCPNDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	defer tx.Rollback(context.Background())
	applied, err := applyTHCPNConfigToPlatform(ctx, s.Queries.WithTx(tx), source.ID, deviceID, ref.ExternalDeviceID, config, actorID, true)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	for _, capability := range capabilitiesForSyncedTHCPNStreams(applied.Streams) {
		if err := platform.AddDeviceCapabilityIfMissing(ctx, s.Queries.WithTx(tx), deviceID, capability); err != nil {
			return platform.UpdateDeviceConfigResult{}, err
		}
	}
	result, _ := json.Marshal(map[string]any{"reconciled_config_id": config.ID, "platform": "synced", "device": "unknown"})
	if _, err := tx.Exec(ctx, `UPDATE source_operations SET status='reconciled',result=result || $2::jsonb,updated_at=now() WHERE device_id=$1 AND kind='config_update' AND status IN ('partial','unknown','running')`, deviceID, result); err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	return platform.UpdateDeviceConfigResult{DeviceID: deviceID, DataSourceID: source.ID, ExternalDeviceID: ref.ExternalDeviceID, Config: thcpnDeviceConfigFromExternal(config), ConfigSnapshot: applied.Snapshot, DataStreams: applied.Streams, Bindings: applied.Bindings, DisabledDataStreams: applied.DisabledStreams, DisabledBindings: applied.DisabledBindings}, nil
}
