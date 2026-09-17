package datasource

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"thcpn-gin/internal/apperr"
)

func (s *Service) ReconcileDeviceConfig(ctx context.Context, deviceID, actorID uuid.UUID) (UpdateTHCPNDeviceConfigResponse, error) {
	if deviceID == uuid.Nil || actorID == uuid.Nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "device and actor are required")
	}
	if ref, err := s.LoRaWANV2GatewayForDevice(ctx, deviceID); err == nil {
		if err = s.refreshLoRaWANV2TemplateSemantics(ctx, deviceID); err != nil {
			return UpdateTHCPNDeviceConfigResponse{}, err
		}
		_, err = s.SyncLoRaWANV2Gateway(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: actorID})
		if err != nil {
			return UpdateTHCPNDeviceConfigResponse{}, err
		}
		_, err = s.db.Exec(ctx, `UPDATE source_operations SET status='reconciled',result=result || '{"platform":"synced","device":"unknown"}'::jsonb,updated_at=now() WHERE device_id=$1 AND kind='config_update' AND status IN ('partial','unknown')`, deviceID)
		return UpdateTHCPNDeviceConfigResponse{DeviceID: deviceID, DataSourceID: ref.DataSourceID}, err
	}
	ref, err := s.queries.GetNumericDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, mapNotFoundOrInternal(err, "device configuration source not found")
	}
	if ref.AdapterCode == AdapterCarbonSink {
		synced, err := s.SyncCarbonDevice(ctx, SyncCarbonDeviceInput{DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, ActorUserID: actorID})
		if err != nil {
			return UpdateTHCPNDeviceConfigResponse{}, err
		}
		return UpdateTHCPNDeviceConfigResponse{DeviceID: deviceID, DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, ConfigSnapshot: synced.ConfigSnapshot}, nil
	}
	if ref.AdapterCode != AdapterTHCPNLegacy {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "configuration reconcile is not supported")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	unlock, err := s.lockSourceSync(ctx, source.ID.String()+"/thcpn")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	defer unlock()
	db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	config, err := readLatestTHCPNDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	defer tx.Rollback(context.Background())
	applied, err := applyTHCPNConfigToPlatform(ctx, s.queries.WithTx(tx), source.ID, deviceID, ref.ExternalDeviceID, config, actorID, true)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	for _, capability := range capabilitiesForSyncedTHCPNStreams(applied.Streams) {
		if err := addDeviceCapabilityIfMissing(ctx, s.queries.WithTx(tx), deviceID, capability); err != nil {
			return UpdateTHCPNDeviceConfigResponse{}, err
		}
	}
	result, _ := json.Marshal(map[string]any{"reconciled_config_id": config.ID, "platform": "synced", "device": "unknown"})
	if _, err := tx.Exec(ctx, `UPDATE source_operations SET status='reconciled',result=result || $2::jsonb,updated_at=now() WHERE device_id=$1 AND kind='config_update' AND status IN ('partial','unknown','running')`, deviceID, result); err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	return UpdateTHCPNDeviceConfigResponse{DeviceID: deviceID, DataSourceID: source.ID, ExternalDeviceID: ref.ExternalDeviceID, Config: thcpnDeviceConfigFromExternal(config), ConfigSnapshot: applied.Snapshot, DataStreams: applied.Streams, Bindings: applied.Bindings, DisabledDataStreams: applied.DisabledStreams, DisabledBindings: applied.DisabledBindings}, nil
}
