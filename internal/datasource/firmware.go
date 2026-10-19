package datasource

import (
	"context"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) RegisterSourceFirmware(ctx context.Context, input platform.SourceFirmwareInput) (int64, error) {
	if input.DataSourceID == uuid.Nil || (input.ExternalDeviceID <= 0 && input.GatewaySN == "") {
		return 0, apperr.New(apperr.KindInvalidArgument, "source firmware target is invalid")
	}
	input.Version = strings.TrimSpace(input.Version)
	if input.Version == "" {
		return 0, apperr.New(apperr.KindInvalidArgument, "firmware version is required")
	}
	source, err := s.GetDataSource(ctx, input.DataSourceID)
	if err != nil {
		return 0, err
	}
	if source.Status != "active" || source.SourceFamily == nil || *source.SourceFamily != input.SourceFamily {
		return 0, apperr.New(apperr.KindInvalidArgument, "firmware data source family is invalid")
	}
	m := s.modules[*source.SourceFamily]
	if m.Firmware == nil {
		return 0, unsupportedCapability()
	}
	return m.Firmware(ctx, input)
}
