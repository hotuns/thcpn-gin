package export

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"io"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"

	"github.com/google/uuid"
	"thcpn-gin/internal/nodeprofile"
)

// Capture display semantics when the job is created. Workers never resolve
// names again, so queued jobs remain stable when devices are renamed.
func (s *Service) snapshotNodeNames(ctx context.Context, resourceType string, id uuid.UUID, raw []byte) ([]byte, error) {
	if resourceType != "device" && resourceType != "device_batch" {
		return raw, nil
	}
	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	delete(cfg, "node_names")
	delete(cfg, "node_indices")
	asset, err := s.devices.GetAsset(ctx, id)
	if err != nil {
		return nil, err
	}
	names := map[string]string{}
	indices := map[string]int64{}
	if asset.DeviceType == "gateway" && resourceType == "device_batch" {
		nodes, err := s.devices.ListGatewayNodes(ctx, id)
		if err != nil {
			return nil, err
		}
		var selectedConfig batchExportConfig
		if err := json.Unmarshal(raw, &selectedConfig); err != nil {
			return nil, err
		}
		selected := map[string]bool{}
		for _, target := range selectedConfig.NodeTargets {
			selected[target.Key()] = true
		}
		for _, deviceID := range selectedConfig.DeviceIDs {
			selected["device:"+strings.TrimSpace(deviceID)] = true
		}
		for _, node := range nodes {
			if !selected[node.Key] {
				continue
			}
			names[node.Key] = node.Name
			if node.Target.DeviceID != nil {
				names[node.Target.DeviceID.String()] = node.Name
			}
		}
		if asset.SourceFamily != "lorawan_v2" {
			children, err := s.devices.ListAdminChildren(ctx, id)
			if err != nil {
				return nil, err
			}
			for _, child := range children {
				if selected["device:"+child.Device.ID.String()] {
					indices[child.Device.ID.String()] = child.Relation.ExternalChildDeviceID
				}
			}
		}
	} else if asset.DeviceType == "carbon_sink" {
		stored, err := nodeprofile.Names(ctx, s.db, id)
		if err != nil {
			return nil, err
		}
		var count int
		if err = s.db.QueryRow(ctx, "SELECT COALESCE((SELECT (value_json::text)::numeric::int FROM device_metadata WHERE device_id=$1 AND key='carbon_nodes_count'),1)", id).Scan(&count); err != nil {
			return nil, err
		}
		var selected carbonStationExportConfig
		if err = json.Unmarshal(raw, &selected); err != nil {
			return nil, err
		}
		for _, index := range selected.NodeIDs {
			if index < 1 || index > count {
				return nil, apperr.New(apperr.KindInvalidArgument, "node index is outside device range")
			}
			names[strconv.Itoa(index)] = nodeprofile.Label(stored[index], index)
		}
	} else {
		return json.Marshal(cfg)
	}
	cfg["node_names"] = names
	cfg["node_indices"] = indices
	return json.Marshal(cfg)
}

func appendNodeColumns(body []byte, index, name string, includeIndex bool) ([]byte, error) {
	reader := csv.NewReader(bytes.NewReader(body))
	var out bytes.Buffer
	writer := csv.NewWriter(&out)
	for i := 0; ; i++ {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if i == 0 {
			if includeIndex {
				row = append(row, "node_index")
			}
			row = append(row, "node_name")
		} else {
			if includeIndex {
				row = append(row, index)
			}
			row = append(row, name)
		}
		if err := writer.Write(row); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return out.Bytes(), writer.Error()
}
