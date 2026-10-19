package thcpn

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) ReadLiveLocations(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]platform.DeviceLocation, error) {
	native, err := s.LiveTHCPNDeviceLocations(ctx, ids)
	if err != nil {
		return nil, err
	}
	result := map[uuid.UUID]platform.DeviceLocation{}
	for id, p := range native {
		result[id] = platform.DeviceLocation{Latitude: p.Latitude, Longitude: p.Longitude, AltitudeM: p.AltitudeM}
	}
	return result, nil
}
