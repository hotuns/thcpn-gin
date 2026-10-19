package datasource

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) GetDeviceConfig(ctx context.Context, id uuid.UUID) (platform.DeviceConfigDetail, error) {
	m, err := s.moduleForDevice(ctx, id)
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}
	if m.Config == nil {
		return platform.DeviceConfigDetail{}, unsupportedCapability()
	}
	return m.Config.GetDeviceConfig(ctx, id)
}
func (s *Service) UpdateDeviceConfig(ctx context.Context, input platform.UpdateDeviceConfigInput) (platform.UpdateDeviceConfigResult, error) {
	m, err := s.moduleForDevice(ctx, input.DeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if m.Config == nil {
		return platform.UpdateDeviceConfigResult{}, unsupportedCapability()
	}
	return m.Config.UpdateDeviceConfig(ctx, input)
}
