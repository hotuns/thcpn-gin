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
	HardwareSN     *string                 `json:"hardware_sn,omitempty"`
	AssetNo        string                  `json:"asset_no,omitempty"`
	PhysicalNodeID *uuid.UUID              `json:"physical_node_id,omitempty"`
	NodeSN         string                  `json:"node_sn,omitempty"`
	Bound          bool                    `json:"bound"`
	Latitude       *float64                `json:"latitude,omitempty"`
	Longitude      *float64                `json:"longitude,omitempty"`
	CustomName     string                  `json:"custom_name"`
	CanRename      bool                    `json:"can_rename"`
	Key            string                  `json:"key"`
	Name           string                  `json:"name"`
	Target         NodeTarget              `json:"target"`
	Streams        []datastream.DataStream `json:"streams"`
}

func (s *Service) withInteraction(ctx context.Context, item Device) (Device, error) {
	items, err := s.withInteractions(ctx, []Device{item})
	if err != nil {
		return Device{}, err
	}
	return items[0], nil
}

func (s *Service) withChildInteractions(ctx context.Context, children []DeviceChild) ([]DeviceChild, error) {
	devices := make([]Device, len(children))
	for i := range children {
		devices[i] = children[i].Device
	}
	devices, err := s.withInteractions(ctx, devices)
	if err != nil {
		return nil, err
	}
	for i := range children {
		children[i].Device = devices[i]
	}
	return children, nil
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
        CASE WHEN src.source_family='lorawan_v2' THEN (SELECT count(*) FROM lorawan_physical_nodes WHERE gateway_device_id=d.id)
             ELSE (SELECT count(*) FROM device_relations WHERE parent_device_id=d.id AND relation_type='gateway_node' AND status='active') END,
        EXISTS (SELECT 1 FROM data_streams WHERE device_id=d.id AND status='active' AND type='telemetry'),
        EXISTS (SELECT 1 FROM data_streams WHERE device_id=d.id AND status='active' AND type='image'), d.iccid, COALESCE(d.asset_no,''), d.hardware_sn
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
		var iccid, hardwareSN *string
		var assetNo string
		if err := rows.Scan(&id, &family, &status, &externalKey, &adapter, &count, &telemetry, &media, &iccid, &assetNo, &hardwareSN); err != nil {
			return nil, err
		}
		item := &items[indices[id]]
		item.ICCID = iccid
		item.AssetNo, item.HardwareSN = assetNo, hardwareSN
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
		features = append(features, "carbon", "sampling", "sensor_config")
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
		nodes = append(nodes, GatewayNode{Key: target.Key(), Name: child.Device.Name, NodeSN: child.Device.SerialNo, AssetNo: child.Device.AssetNo, HardwareSN: child.Device.HardwareSN, CustomName: child.Device.Name, Target: target, Streams: active})
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
	locations, err := s.db.Query(ctx, `SELECT node_index,latitude,longitude FROM node_profiles WHERE device_id=$1`, gateway.ID)
	if err != nil {
		return nil, err
	}
	positions := map[int][2]*float64{}
	for locations.Next() {
		var index int
		var lat, lon *float64
		if err := locations.Scan(&index, &lat, &lon); err != nil {
			locations.Close()
			return nil, err
		}
		positions[index] = [2]*float64{lat, lon}
	}
	locationErr := locations.Err()
	locations.Close()
	if locationErr != nil {
		return nil, locationErr
	}
	registry, err := s.db.Query(ctx, `SELECT id,sn,node_index,asset_no,hardware_sn FROM lorawan_physical_nodes WHERE gateway_device_id=$1 ORDER BY node_index`, gateway.ID)
	if err != nil {
		return nil, err
	}
	bound := map[int]GatewayNode{}
	for registry.Next() {
		var id uuid.UUID
		var sn, assetNo string
		var hardwareSN *string
		var index int
		if err := registry.Scan(&id, &sn, &index, &assetNo, &hardwareSN); err != nil {
			registry.Close()
			return nil, err
		}
		bound[index] = GatewayNode{PhysicalNodeID: &id, NodeSN: sn, AssetNo: assetNo, HardwareSN: hardwareSN, Bound: true}
	}
	registryErr := registry.Err()
	registry.Close()
	if registryErr != nil {
		return nil, registryErr
	}
	slots, err := s.db.Query(ctx, `SELECT node_index FROM lorawan_physical_nodes WHERE gateway_device_id=$1 UNION SELECT node_index FROM node_profiles WHERE device_id=$1 UNION SELECT (b.adapter_config_json->>'node_index')::int FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id WHERE ds.device_id=$1 AND b.adapter_code='lorawan_v2' AND b.adapter_config_json ? 'node_index' ORDER BY 1`, gateway.ID)
	if err != nil {
		return nil, err
	}
	byIndex := map[int]int{}
	for slots.Next() {
		var index int
		if err := slots.Scan(&index); err != nil {
			slots.Close()
			return nil, err
		}
		if index < 1 || index > 254 {
			continue
		}
		target := NodeTarget{Kind: "gateway_node", GatewayDeviceID: &gateway.ID, NodeIndex: &index}
		node := bound[index]
		node.Latitude = positions[index][0]
		node.Longitude = positions[index][1]
		node.Key = target.Key()
		node.Name = v2NodeName(names[index], index)
		node.CustomName = names[index]
		node.Target = target
		node.Streams = []datastream.DataStream{}
		byIndex[index] = len(nodes)
		nodes = append(nodes, node)
	}
	slotsErr := slots.Err()
	slots.Close()
	if slotsErr != nil {
		return nil, slotsErr
	}
	rows, err := s.db.Query(ctx, `SELECT ds.id, ds.device_id, ds.code, ds.name, ds.type, ds.unit, ds.status, ds.created_by, ds.created_at, ds.updated_at, ds.purpose, b.adapter_config_json
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
		if err := rows.Scan(&stream.ID, &stream.DeviceID, &stream.Code, &stream.Name, &stream.Type, &stream.Unit, &stream.Status, &stream.CreatedBy, &stream.CreatedAt, &stream.UpdatedAt, &stream.Purpose, &raw); err != nil {
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
		position, exists := byIndex[*cfg.NodeIndex]
		if !exists {
			continue
		}
		// The source metric key remains the stable selection identity, while the
		// DataStream name carries the platform-managed display semantics.
		stream.Code = cfg.Metric
		nodes[position].Streams = append(nodes[position].Streams, stream)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return nodes, nil
}

// Scope controls presentation and live reads, never the historical query identity.
func (s *Service) ListGatewayNodesInScope(ctx context.Context, gatewayID uuid.UUID, scope string) ([]GatewayNode, error) {
	if scope != "bound" && scope != "history" && scope != "all" {
		return nil, apperr.New(apperr.KindInvalidArgument, "scope must be bound, history or all")
	}
	nodes, err := s.ListGatewayNodes(ctx, gatewayID)
	if err != nil {
		return nil, err
	}
	result := make([]GatewayNode, 0, len(nodes))
	for _, node := range nodes {
		if node.Target.Kind == "gateway_node" {
			if scope == "bound" && !node.Bound || scope == "history" && node.Bound {
				continue
			}
		} else if scope == "history" {
			continue
		}
		result = append(result, node)
	}
	return result, nil
}

func v2NodeName(name string, index int) string {
	if name != "" {
		return name
	}
	return fmt.Sprintf("节点 %d", index)
}
