package thcpn

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) ReadDeviceRuntime(ctx context.Context, ids []uuid.UUID) (platform.DeviceRuntimeBatch, error) {
	native, err := s.THCPNDeviceRuntime(ctx, ids)
	if err != nil {
		return platform.DeviceRuntimeBatch{}, err
	}
	result := platform.DeviceRuntimeBatch{RefreshedAt: native.RefreshedAt}
	for _, item := range native.Items {
		attrs := map[string]platform.RuntimeAttribute{}
		for key, a := range item.Attributes {
			attrs[key] = platform.RuntimeAttribute{RawValue: a.RawValue, ParsedValue: a.ParsedValue, SampledAt: a.SampledAt, SourceTable: a.SourceTable}
		}
		result.Items = append(result.Items, platform.DeviceRuntimeItem{DeviceID: item.DeviceID, SourceDevice: platform.RuntimeDevice{Latitude: item.SourceDevice.Latitude, Longitude: item.SourceDevice.Longitude, Status: item.SourceDevice.Status, UpdatedAt: item.SourceDevice.UpdatedAt}, Attributes: attrs})
	}
	for _, f := range native.Failures {
		result.Failures = append(result.Failures, platform.DeviceRuntimeFailure{DeviceID: f.DeviceID, Error: f.Error})
	}
	return result, nil
}
