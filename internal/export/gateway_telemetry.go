package export

import (
	"context"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

// Gateway spreadsheet exports include node metrics as well as gateway diagnostics.
// A node is either a child device or an indexed target on the gateway itself.
func (p *Processor) queryGatewayTelemetry(ctx context.Context, id uuid.UUID, start, end time.Time) ([]telemetrySeries, error) {
	streams, err := p.queries.ListDataStreamsByDevice(ctx, id)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list gateway streams", err)
	}
	nodes, err := p.devices.ListGatewayNodes(ctx, id)
	if err != nil {
		return nil, err
	}
	ids := []uuid.UUID{}
	labels := map[uuid.UUID]string{}
	add := func(streamID uuid.UUID, label string) {
		if _, exists := labels[streamID]; !exists {
			ids = append(ids, streamID)
		}
		labels[streamID] = label
	}
	for _, stream := range streams {
		if stream.Status == "active" && stream.Type == "telemetry" {
			add(stream.ID, stream.Name)
		}
	}
	for _, node := range nodes {
		for _, stream := range node.Streams {
			add(stream.ID, node.Name+" · "+stream.Name)
		}
	}
	if len(ids) == 0 {
		return nil, apperr.New(apperr.KindDataSource, "网关及其节点没有可导出的指标，请先同步网关节点和数据流后重试")
	}
	result := make([]telemetrySeries, 0, len(ids))
	for _, streamID := range ids {
		stream, err := p.queries.GetDataStream(ctx, streamID)
		if err != nil {
			return nil, mapNotFoundOrInternal(err, "gateway stream not found")
		}
		item, err := p.queryTelemetryStreamFull(ctx, stream, start, end)
		if err != nil {
			return nil, err
		}
		item.Name = labels[streamID]
		result = append(result, item)
	}
	return result, nil
}
