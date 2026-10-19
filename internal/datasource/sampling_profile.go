package datasource

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (s *Service) GetSamplingProfile(ctx context.Context, id uuid.UUID) (platform.SamplingProfileResponse, error) {
	m, err := s.moduleForDevice(ctx, id)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	if m.Sampling == nil {
		return platform.SamplingProfileResponse{}, unsupportedCapability()
	}
	return m.Sampling.GetSamplingProfile(ctx, id)
}
func (s *Service) UpdateSamplingProfile(ctx context.Context, input platform.SamplingProfileUpdateInput) (platform.SamplingProfileResponse, error) {
	m, err := s.moduleForDevice(ctx, input.DeviceID)
	if err != nil {
		return platform.SamplingProfileResponse{}, err
	}
	if m.Sampling == nil {
		return platform.SamplingProfileResponse{}, unsupportedCapability()
	}
	return m.Sampling.UpdateSamplingProfile(ctx, input)
}
