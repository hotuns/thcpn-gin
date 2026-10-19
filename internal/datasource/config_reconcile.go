package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) ReconcileDeviceConfig(ctx context.Context, id, actor uuid.UUID) (platform.UpdateDeviceConfigResult, error) {
	if id == uuid.Nil || actor == uuid.Nil {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "device and actor are required")
	}
	m, err := s.moduleForDevice(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if m.Reconcile == nil {
		return platform.UpdateDeviceConfigResult{}, unsupportedCapability()
	}
	return m.Reconcile.ReconcileConfig(ctx, id, actor)
}
