package carbon

import (
	"context"
	"errors"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/jackc/pgx/v5"

	"github.com/google/uuid"
)

func (s *Service) GetDeviceConfig(ctx context.Context, deviceID uuid.UUID) (platform.DeviceConfigDetail, error) {
	if s.DB == nil {
		return platform.DeviceConfigDetail{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, platform.MapNotFoundOrInternal(err, "device source ref not found")
	}
	if ref.AdapterCode != platform.AdapterCarbonSink {
		return platform.DeviceConfigDetail{}, apperr.New(apperr.KindInvalidArgument, "not a carbon device")
	}

	db, err := s.openCarbonConfigDB(ctx, ref.DataSourceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}
	config, err := readLatestCarbonDeviceConfig(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}
	detail := platform.DeviceConfigDetail{DeviceID: deviceID, DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, LatestConfig: carbonConfigForResponse(ref.ExternalDeviceID, config)}
	if snapshot, err := s.Queries.GetLatestDeviceConfigSnapshotByDevice(ctx, deviceID); err == nil {
		converted := platform.DeviceConfigSnapshotFromSQL(snapshot)
		detail.LatestSnapshot = &converted
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return platform.DeviceConfigDetail{}, platform.MapNotFoundOrInternal(err, "read carbon config snapshot")
	}
	return detail, nil
}

func (s *Service) UpdateDeviceConfig(ctx context.Context, input platform.UpdateDeviceConfigInput) (platform.UpdateDeviceConfigResult, error) {
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, input.DeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, platform.MapNotFoundOrInternal(err, "carbon device source not found")
	}
	if ref.AdapterCode != platform.AdapterCarbonSink {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "not a carbon device")
	}
	return s.updateCarbonDeviceConfig(ctx, input, ref)
}
func (s *Service) GetSamplingProfile(ctx context.Context, id uuid.UUID) (platform.SamplingProfileResponse, error) {
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, id)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	if ref.AdapterCode != platform.AdapterCarbonSink {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindInvalidArgument, "not a carbon device")
	}
	return s.getCarbonSamplingProfile(ctx, id, ref)
}
func (s *Service) UpdateSamplingProfile(ctx context.Context, input platform.SamplingProfileUpdateInput) (platform.SamplingProfileResponse, error) {
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, input.DeviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	if ref.AdapterCode != platform.AdapterCarbonSink {
		return platform.SamplingProfileResponse{}, apperr.New(apperr.KindInvalidArgument, "not a carbon device")
	}
	return s.updateCarbonSamplingProfile(ctx, input, ref)
}
func (s *Service) ReconcileConfig(ctx context.Context, id, actor uuid.UUID) (platform.UpdateDeviceConfigResult, error) {
	ref, err := s.Queries.GetNumericDeviceSourceRefByDevice(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if ref.AdapterCode != platform.AdapterCarbonSink {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "not a carbon device")
	}
	synced, err := s.SyncCarbonDevice(ctx, SyncCarbonDeviceInput{DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, ActorUserID: actor})
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	detail, err := s.GetDeviceConfig(ctx, id)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if err := s.MarkConfigReconciled(ctx, id, detail.LatestConfig.ID); err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	return platform.UpdateDeviceConfigResult{DeviceID: id, DataSourceID: ref.DataSourceID, ExternalDeviceID: ref.ExternalDeviceID, Config: detail.LatestConfig, ConfigSnapshot: synced.ConfigSnapshot}, nil
}
