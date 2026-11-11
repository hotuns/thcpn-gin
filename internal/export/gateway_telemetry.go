package export

import (
	"context"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/device"
)

// Gateway spreadsheets contain measurements; diagnostic history uses the status export.
// A node is either a child device or an indexed target on the gateway itself.
func (p *Processor) queryGatewayTelemetry(ctx context.Context, gateway device.Device, start, end time.Time) ([]telemetrySeries, error) {
	streams, err := p.queries.ListDataStreamsByDevice(ctx, gateway.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list gateway streams", err)
	}
	nodes, err := p.devices.ListGatewayNodes(ctx, gateway.ID)
	if err != nil {
		return nil, err
	}
	ids := []uuid.UUID{}
	labels := map[uuid.UUID]string{}
	targets := map[uuid.UUID]device.GatewayNode{}
	add := func(streamID uuid.UUID, label string) {
		if _, exists := labels[streamID]; !exists {
			ids = append(ids, streamID)
		}
		labels[streamID] = label
	}
	for _, stream := range streams {
		if stream.Status == "active" && stream.Type == "telemetry" && stream.Purpose == "measurement" {
			add(stream.ID, stream.Name)
		}
	}
	for _, node := range nodes {
		for _, stream := range node.Streams {
			if stream.Purpose != "measurement" {
				continue
			}
			add(stream.ID, node.Name+" · "+stream.Name)
			targets[stream.ID] = node
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
		item.MetricName = stream.Name
		item.NodeKey = "gateway:" + gateway.ID.String()
		item.NodeName = "网关"
		item.GatewayAssetNo = gateway.AssetNo
		if node, ok := targets[streamID]; ok {
			item.NodeKey = node.Key
			item.NodeName = node.Name
			item.AssetNo = node.AssetNo
			item.NodeIndex = node.Target.NodeIndex
			if node.Target.Kind == "gateway_node" {
				item.CurrentNodeSN = node.NodeSN
			}
		}
		item.Name = labels[streamID]
		result = append(result, item)
	}
	return result, nil
}
