package lorawanv2

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) ReconcileConfig(ctx context.Context, id, actor uuid.UUID) (platform.UpdateDeviceConfigResult, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if err := s.refreshLoRaWANV2TemplateSemantics(ctx, id); err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if _, err := s.SyncLoRaWANV2Gateway(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: actor}); err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	err = s.MarkConfigReconciled(ctx, id, 0)
	return platform.UpdateDeviceConfigResult{DeviceID: id, DataSourceID: ref.DataSourceID}, err
}
