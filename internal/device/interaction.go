package device

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datastream"
	"thcpn-gin/internal/nodeprofile"
)

type NodeTarget struct {
	Kind            string     `json:"kind"`
	DeviceID        *uuid.UUID `json:"device_id,omitempty"`
	GatewayDeviceID *uuid.UUID `json:"gateway_device_id,omitempty"`
	NodeIndex       *int       `json:"node_index,omitempty"`
}

func (t NodeTarget) Key() string {
	if t.Kind == "device" && t.DeviceID != nil {
		return "device:" + t.DeviceID.String()
	}
	if t.Kind == "gateway_node" && t.GatewayDeviceID != nil && t.NodeIndex != nil {
		return fmt.Sprintf("gateway:%s:node:%d", *t.GatewayDeviceID, *t.NodeIndex)
	}
	return ""
}

type GatewayNode struct {
	CustomName string                  `json:"custom_name"`
	CanRename  bool                    `json:"can_rename"`
	Key        string                  `json:"key"`
	Name       string                  `json:"name"`
	Target     NodeTarget              `json:"target"`
	Streams    []datastream.DataStream `json:"streams"`
}

func (s *Service) withInteraction(ctx context.Context, item Device) (Device, error) {
	items, err := s.withInteractions(ctx, []Device{item})
	if err != nil {
		return Device{}, err
	}
	return items[0], nil
}

func (s *Service) withInteractions(ctx context.Context, items []Device) ([]Device, error) {
	if len(items) == 0 {
		return items, nil
	}
	ids := make([]uuid.UUID, len(items))
	indices := make(map[uuid.UUID]int, len(items))
	for i := range items {
		ids[i] = items[i].ID
		indices[items[i].ID] = i
	}
	rows, err := s.db.Query(ctx, `SELECT d.id, COALESCE(src.source_family,''), COALESCE(src.status,''),
        COALESCE(ref.external_key,''), COALESCE(ref.adapter_code,''),
        CASE WHEN src.source_family='lorawan_v2' THEN COALESCE((SELECT value_json::text::int FROM device_metadata WHERE device_id=d.id AND key='lorawan_v2_nodes_count'),0)
             ELSE (SELECT count(*) FROM device_relations WHERE parent_device_id=d.id AND relation_type='gateway_node' AND status='active') END,
        EXISTS (SELECT 1 FROM data_streams WHERE device_id=d.id AND status='active' AND type='telemetry'),
        EXISTS (SELECT 1 FROM data_streams WHERE device_id=d.id AND status='active' AND type='image')
        FROM devices d LEFT JOIN device_source_refs ref ON ref.device_id=d.id AND ref.status='active'
        LEFT JOIN data_sources src ON src.id=ref.data_source_id WHERE d.id=ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "load device interaction", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var family, status, externalKey, adapter string
		var count int64
		var telemetry, media bool
		if err := rows.Scan(&id, &family, &status, &externalKey, &adapter, &count, &telemetry, &media); err != nil {
			return nil, err
		}
		item := &items[indices[id]]
		item.SourceFamily, item.SourceStatus, item.ChildCount = family, status, count
		item.ExternalKey = externalKey
		item.Features = interactionFeatures(item.DeviceType, family, telemetry, media)
		if adapter != "lorawan_v2" && externalKey != "" {
			externalID, err := strconv.ParseInt(externalKey, 10, 64)
			if err != nil {
				return nil, apperr.Wrap(apperr.KindInternal, "invalid numeric device source key", err)
			}
			item.ExternalDeviceID = &externalID
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func interactionFeatures(role, family string, telemetry, media bool) []string {
	features := []string{"profile", "activity"}
	if telemetry || family == "thcpn" && role != "camera" || family == "lorawan_v2" {
		features = append(features, "telemetry")
	}
	if media {
		features = append(features, "media")
	}
	if role == "gateway" {
		features = append(features, "nodes")
	}
	switch family {
	case "thcpn":
		if role != "camera" {
			features = append(features, "sampling", "sensor_config", "logs")
		}
	case "carbon":
		features = append(features, "carbon", "sampling")
	case "lorawan_v2":
		features = append(features, "sensor_config", "logs")
	}
	if role == "camera" {
		features = append(features, "video")
	}
	return features
}

func (s *Service) ListGatewayNodes(ctx context.Context, gatewayID uuid.UUID) ([]GatewayNode, error) {
	gateway, err := s.GetAsset(ctx, gatewayID)
	if err != nil {
		return nil, err
	}
	if gateway.DeviceType != "gateway" {
		return nil, apperr.New(apperr.KindInvalidArgument, "device is not a gateway")
	}
	if gateway.SourceFamily == "lorawan_v2" {
		return s.listIndexedNodes(ctx, gateway)
	}
	children, err := s.ListAdminChildren(ctx, gatewayID)
	if err != nil {
		return nil, err
	}
	nodes := make([]GatewayNode, 0, len(children))
	streams := datastream.NewService(s.db)
	for _, child := range children {
		id := child.Device.ID
		target := NodeTarget{Kind: "device", DeviceID: &id}
		items, err := streams.ListByDevice(ctx, id)
		if err != nil {
			return nil, err
		}
		active := make([]datastream.DataStream, 0)
		for _, stream := range items {
			if stream.Status == "active" && stream.Type == "telemetry" {
				active = append(active, stream)
			}
		}
		nodes = append(nodes, GatewayNode{Key: target.Key(), Name: child.Device.Name, CustomName: child.Device.Name, Target: target, Streams: active})
	}
	return nodes, nil
}

func (s *Service) listIndexedNodes(ctx context.Context, gateway Device) ([]GatewayNode, error) {
	if gateway.ChildCount < 0 || gateway.ChildCount > 254 {
		return nil, apperr.New(apperr.KindInternal, "invalid gateway node count")
	}
	names, err := nodeprofile.Names(ctx, s.db, gateway.ID)
	if err != nil {
		return nil, err
	}
	nodes := make([]GatewayNode, 0, gateway.ChildCount)
	for index := 1; index <= int(gateway.ChildCount); index++ {
		target := NodeTarget{Kind: "gateway_node", GatewayDeviceID: &gateway.ID, NodeIndex: &index}
		nodes = append(nodes, GatewayNode{Key: target.Key(), Name: nodeprofile.Label(names[index], index), CustomName: names[index], Target: target, Streams: []datastream.DataStream{}})
	}
	rows, err := s.db.Query(ctx, `SELECT ds.id, ds.device_id, ds.code, ds.name, ds.type, ds.unit, ds.status, ds.created_by, ds.created_at, ds.updated_at, b.adapter_config_json
        FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id AND b.status='active' AND b.adapter_code='lorawan_v2'
        JOIN device_source_refs ref ON ref.device_id=ds.device_id AND ref.data_source_id=b.data_source_id AND ref.adapter_code='lorawan_v2' AND ref.status='active'
        WHERE ds.device_id=$1 AND ds.status='active' AND ds.type='telemetry' AND b.adapter_config_json->>'gateway_sn'=ref.external_key
        ORDER BY ds.code, ds.id`, gateway.ID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "list indexed node streams", err)
	}
	defer rows.Close()
	for rows.Next() {
		var stream datastream.DataStream
		var raw []byte
		if err := rows.Scan(&stream.ID, &stream.DeviceID, &stream.Code, &stream.Name, &stream.Type, &stream.Unit, &stream.Status, &stream.CreatedBy, &stream.CreatedAt, &stream.UpdatedAt, &raw); err != nil {
			return nil, err
		}
		var cfg struct {
			NodeIndex *int   `json:"node_index"`
			Metric    string `json:"metric"`
		}
		if err := json.Unmarshal(raw, &cfg); err != nil {
			return nil, apperr.Wrap(apperr.KindInternal, "invalid node stream binding", err)
		}
		if cfg.NodeIndex == nil {
			continue
		}
		if *cfg.NodeIndex < 1 || *cfg.NodeIndex > len(nodes) {
			continue
		}
		// The source metric key remains the stable selection identity, while the
		// DataStream name carries the platform-managed display semantics.
		stream.Code = cfg.Metric
		nodes[*cfg.NodeIndex-1].Streams = append(nodes[*cfg.NodeIndex-1].Streams, stream)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return nodes, nil
}
