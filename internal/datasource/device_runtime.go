package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"time"

	"github.com/google/uuid"
)

func (s *Service) DeviceRuntime(ctx context.Context, ids []uuid.UUID) (platform.DeviceRuntimeBatch, error) {
	result := platform.DeviceRuntimeBatch{RefreshedAt: time.Now().UTC()}
	if len(ids) == 0 {
		return result, nil
	}
	if len(ids) > 200 {
		return result, apperr.New(apperr.KindInvalidArgument, "too many runtime devices")
	}
	groups, err := s.groupDeviceSources(ctx, ids)
	if err != nil {
		return result, err
	}
	for family, devices := range groups {
		reader := s.modules[family].Runtime
		if reader == nil {
			continue
		}
		batch, err := reader.ReadDeviceRuntime(ctx, devices)
		if err != nil {
			for _, id := range devices {
				result.Failures = append(result.Failures, platform.DeviceRuntimeFailure{DeviceID: id, Error: apperr.MessageOf(err)})
			}
			continue
		}
		result.Items = append(result.Items, batch.Items...)
		result.Failures = append(result.Failures, batch.Failures...)
	}
	return result, nil
}

func (s *Service) groupDeviceSources(ctx context.Context, ids []uuid.UUID) (map[string][]uuid.UUID, error) {
	if s.DB == nil {
		return nil, apperr.New(apperr.KindInternal, "database is not configured")
	}
	rows, err := s.DB.Query(ctx, `SELECT ref.device_id,source.source_family FROM device_source_refs ref JOIN data_sources source ON source.id=ref.data_source_id WHERE ref.device_id=ANY($1::uuid[]) AND ref.status='active' AND source.status='active' AND source.source_family IS NOT NULL`, ids)
	if err != nil {
		return nil, err
	}
	groups := map[string][]uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		var family string
		if err := rows.Scan(&id, &family); err != nil {
			rows.Close()
			return nil, err
		}
		groups[family] = append(groups[family], id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return groups, nil
}
func (s *Service) LiveDeviceLocations(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]platform.DeviceLocation, error) {
	result := map[uuid.UUID]platform.DeviceLocation{}
	if len(ids) == 0 {
		return result, nil
	}
	groups, err := s.groupDeviceSources(ctx, ids)
	if err != nil {
		return nil, err
	}
	for family, devices := range groups {
		reader := s.modules[family].Locations
		if reader == nil {
			continue
		}
		points, err := reader.ReadLiveLocations(ctx, devices)
		if err != nil {
			return nil, err
		}
		for id, p := range points {
			result[id] = p
		}
	}
	return result, nil
}
