package thcpn

import (
	"context"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"time"

	"github.com/google/uuid"
)

func (s *Service) GetSamplingProfile(ctx context.Context, deviceID uuid.UUID) (platform.SamplingProfileResponse, error) {
	if s.DB == nil {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}

	detail, err := s.GetDeviceConfig(ctx, deviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	return platform.SamplingProfileFromConfig(deviceID, detail.LatestConfig), nil
}
func (s *Service) UpdateSamplingProfile(ctx context.Context, input platform.SamplingProfileUpdateInput) (platform.SamplingProfileResponse, error) {
	if s.DB == nil {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	if input.ExpectedConfigID <= 0 {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}

	detail, err := s.GetDeviceConfig(ctx, input.DeviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	if detail.LatestConfig.ID != input.ExpectedConfigID {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	schedule, err := platform.SamplingScheduleForInput(input)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	control, err := platform.MergeSamplingSchedule(detail.LatestConfig.ControlJSON, schedule)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	updated, err := s.UpdateDeviceConfig(ctx, platform.UpdateDeviceConfigInput{
		DeviceID: input.DeviceID, DataJSON: detail.LatestConfig.DataJSON, ImageJSON: detail.LatestConfig.ImageJSON,
		ControlJSON: control, ActorUserID: input.ActorUserID, ExpectedConfigID: input.ExpectedConfigID,
	})
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	response := platform.SamplingProfileFromConfig(input.DeviceID, updated.Config)
	response.WriteState = updated.WriteState
	response.Warnings = updated.Warnings
	now := time.Now().UTC()
	response.DispatchedAt = &now
	return response, nil
}
