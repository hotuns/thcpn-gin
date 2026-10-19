package lorawanv2

import (
	"context"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

func (r *Runtime) QueryBatch(ctx context.Context, source platform.DataSource, req platform.TelemetryBatchQuery) (platform.TelemetryBatchResult, error) {
	result := platform.TelemetryBatchResult{Series: map[uuid.UUID]platform.TelemetryResult{}, Errors: map[uuid.UUID]string{}}
	err := r.queryLoRaWANV2TelemetryBatch(ctx, source, req, req.Bindings, &result)
	return result, err
}
