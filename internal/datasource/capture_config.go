package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) GetCaptureConfig(ctx context.Context, id uuid.UUID) (platform.CaptureConfig, error) {
	module, err := s.moduleForDevice(ctx, id)
	if err != nil {
		return platform.CaptureConfig{}, err
	}
	if module.Config == nil || len(module.Capture.Sensors) == 0 {
		return platform.CaptureConfig{}, unsupportedCapability()
	}
	current, err := module.Config.GetDeviceConfig(ctx, id)
	if err != nil {
		return platform.CaptureConfig{}, err
	}
	return module.Capture.Project(current.LatestConfig)
}

func (s *Service) UpdateCaptureConfig(ctx context.Context, id, actor uuid.UUID, version int64, changes []platform.CaptureConfigChange) (platform.UpdateDeviceConfigResult, error) {
	if version <= 0 || len(changes) == 0 || len(changes) > 512 {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "请提供当前配置版本和要保存的改动")
	}
	module, err := s.moduleForDevice(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if module.Config == nil || len(module.Capture.Sensors) == 0 {
		return platform.UpdateDeviceConfigResult{}, unsupportedCapability()
	}
	current, err := module.Config.GetDeviceConfig(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if current.LatestConfig.ID != version {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindConflict, "设备配置已变更，请重新读取后核对")
	}
	data, image, err := module.Capture.Patch(current.LatestConfig, changes)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	return module.Config.UpdateDeviceConfig(ctx, platform.UpdateDeviceConfigInput{
		DeviceID: id, ActorUserID: actor, ExpectedConfigID: version, DataJSON: data, ImageJSON: image, CapturePatch: true,
	})
}
