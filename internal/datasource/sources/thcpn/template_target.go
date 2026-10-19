package thcpn

import (
	"context"

	"github.com/google/uuid"
)

func (s *Service) SensorTemplateTarget(ctx context.Context, id uuid.UUID) (string, *string, error) {
	db, ref, err := s.openTHCPNDevice(ctx, id)
	if err != nil {
		return "", nil, err
	}
	device, err := readTHCPNExternalDevice(ctx, db, ref.ExternalDeviceID)
	if err != nil {
		return "", nil, err
	}
	return "thcpn", device.DeviceType, nil
}
