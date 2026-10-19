package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) CreateSourceDevice(ctx context.Context, input platform.CreateSourceDeviceInput) (platform.CreatedSourceDevice, error) {
	if input.DataSourceID == uuid.Nil || input.ActorUserID == uuid.Nil {
		return platform.CreatedSourceDevice{}, apperr.New(apperr.KindInvalidArgument, "data source and actor are required")
	}
	if s.DB == nil {
		return platform.CreatedSourceDevice{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	creator := s.creators[input.SourceKind]
	if creator.Create == nil {
		return platform.CreatedSourceDevice{}, unsupportedCapability()
	}
	return creator.Create(ctx, input)
}
func (s *Service) RetryCreatedSourceDeviceSync(ctx context.Context, sourceID uuid.UUID, kind string, externalID int64, actor uuid.UUID) (platform.CreatedSourceDevice, error) {
	if sourceID == uuid.Nil || externalID <= 0 || actor == uuid.Nil {
		return platform.CreatedSourceDevice{}, apperr.New(apperr.KindInvalidArgument, "data source, source device and actor are required")
	}
	creator := s.creators[kind]
	if creator.Retry == nil {
		return platform.CreatedSourceDevice{}, unsupportedCapability()
	}
	return creator.Retry(ctx, sourceID, kind, externalID, actor)
}
func sourceFamilyForCreatedDeviceKind(kind string) (string, error) {
	family := creationFamilies[kind]
	if family == "" {
		return "", unsupportedCapability()
	}
	return family, nil
}
