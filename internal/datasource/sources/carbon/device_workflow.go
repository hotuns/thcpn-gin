package carbon

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) CreateManagedDevice(ctx context.Context, input platform.CreateSourceDeviceInput) (platform.CreatedSourceDevice, error) {
	result := platform.CreatedSourceDevice{DataSourceID: input.DataSourceID, SourceKind: input.SourceKind}
	source, err := s.LoadMySQLDataSourceForFamily(ctx, input.DataSourceID, "carbon")
	if err != nil {
		return result, err
	}
	id, sn, err := s.createCarbonSourceDevice(ctx, source, input)
	if err != nil {
		return result, err
	}
	result, err = s.RetryCreatedDevice(ctx, input.DataSourceID, input.SourceKind, id, input.ActorUserID)
	result.SN = sn
	return result, err
}
func (s *Service) RetryCreatedDevice(ctx context.Context, sourceID uuid.UUID, kind string, externalID int64, actor uuid.UUID) (platform.CreatedSourceDevice, error) {
	result := platform.CreatedSourceDevice{DataSourceID: sourceID, SourceKind: kind, SourceDeviceID: externalID}
	if kind != platform.CreatedSourceDeviceCarbon {
		return result, apperr.New(apperr.KindInvalidArgument, "invalid carbon source kind")
	}
	synced, err := s.SyncCarbonDevice(ctx, SyncCarbonDeviceInput{DataSourceID: sourceID, ExternalDeviceID: externalID, ActorUserID: actor})
	if err != nil {
		result.SyncError = apperr.MessageOf(err)
		return result, nil
	}
	result.PlatformDeviceID = &synced.Device.ID
	return result, nil
}
