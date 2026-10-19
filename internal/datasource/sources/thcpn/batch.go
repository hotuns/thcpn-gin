package thcpn

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (r *Runtime) QueryBatch(ctx context.Context, source platform.DataSource, req platform.TelemetryBatchQuery) (platform.TelemetryBatchResult, error) {
	result := platform.TelemetryBatchResult{Series: map[uuid.UUID]platform.TelemetryResult{}, Errors: map[uuid.UUID]string{}}
	groups := map[string][]thcpnBatchMetric{}
	for _, binding := range req.Bindings {
		cfg, err := parseTHCPNLegacyTelemetryConfig(binding.AdapterConfigJSON)
		if err != nil {
			return result, err
		}
		if !supportsTHCPNTelemetryBatch(cfg) {
			item, err := r.QueryThcpnLegacyMySQLTelemetry(ctx, source, platform.TelemetryQuery{Binding: binding, Start: req.Start, End: req.End, Limit: req.Limit, Adaptive: req.Adaptive, TargetPoints: req.TargetPoints})
			if err != nil {
				result.Errors[binding.DataStreamID] = apperr.MessageOf(err)
				continue
			}
			result.Series[binding.DataStreamID] = item
			result.SourceScans++
			result.RowsRead += item.SourceCount
			continue
		}
		key := thcpnTelemetryBatchGroupKey(cfg)
		groups[key] = append(groups[key], thcpnBatchMetric{Binding: binding, Config: cfg})
	}
	for _, group := range groups {
		batch, err := r.queryThcpnLegacyMySQLTelemetryBatch(ctx, source, req, group)
		if err != nil {
			for _, metric := range group {
				result.Errors[metric.Binding.DataStreamID] = apperr.MessageOf(err)
			}
			continue
		}
		for id, item := range batch.Series {
			result.Series[id] = item
		}
		result.SourceScans += batch.SourceScans
		result.RowsRead += batch.RowsRead
	}
	return result, nil
}
