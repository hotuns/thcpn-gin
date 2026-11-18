package export

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/observation"
)

const adminDeviceBundleZIP = "admin_device_bundle_zip"

type adminBundlePart struct {
	ResourceType  string          `json:"resource_type"`
	ResourceID    uuid.UUID       `json:"resource_id"`
	ExportType    string          `json:"export_type"`
	RequestConfig json.RawMessage `json:"request_config"`
}

type adminBundleConfig struct {
	StartTime time.Time         `json:"start_time"`
	EndTime   time.Time         `json:"end_time"`
	DataPhase string            `json:"data_phase,omitempty"`
	DeviceIDs []uuid.UUID       `json:"device_ids"`
	Parts     []adminBundlePart `json:"parts"`
}

func parseAdminBundleConfig(raw json.RawMessage) (adminBundleConfig, error) {
	var cfg adminBundleConfig
	if err := json.Unmarshal(raw, &cfg); err != nil || cfg.StartTime.IsZero() || !cfg.EndTime.After(cfg.StartTime) {
		return cfg, apperr.New(apperr.KindInvalidArgument, "请选择有效的批量导出时间范围")
	}
	if len(cfg.Parts) < 2 {
		return cfg, apperr.New(apperr.KindInvalidArgument, "请至少选择两台设备")
	}
	switch cfg.DataPhase {
	case "", observation.All, observation.Formal, observation.Testing:
	default:
		return cfg, apperr.New(apperr.KindInvalidArgument, "无效的数据阶段")
	}
	// The group ZIP's resource is its first node. Use the actual gateway ID as
	// the member of the outer bundle and never take membership from the caller.
	cfg.DeviceIDs = make([]uuid.UUID, 0, len(cfg.Parts))
	seen := make(map[uuid.UUID]bool, len(cfg.Parts))
	for _, part := range cfg.Parts {
		if part.ResourceID == uuid.Nil || part.ExportType != cfg.Parts[0].ExportType {
			return cfg, apperr.New(apperr.KindInvalidArgument, "同一批导出须使用相同文件类型和有效设备")
		}
		id := part.ResourceID
		switch part.ExportType {
		case "telemetry_csv", "telemetry_excel", "media_zip", "carbon_station_zip":
			if part.ResourceType != "device" {
				return cfg, apperr.New(apperr.KindInvalidArgument, "批量任务只能直接选择设备")
			}
		case "group_site_zip":
			var group struct {
				GatewayID uuid.UUID `json:"gateway_id"`
			}
			if part.ResourceType != "device_batch" || json.Unmarshal(part.RequestConfig, &group) != nil {
				return cfg, apperr.New(apperr.KindInvalidArgument, "组网任务需要有效的网关和节点")
			}
			id = group.GatewayID
		default:
			return cfg, apperr.New(apperr.KindInvalidArgument, "不支持此批量导出文件类型")
		}
		if id == uuid.Nil || seen[id] {
			return cfg, apperr.New(apperr.KindInvalidArgument, "导出设备无效或重复")
		}
		seen[id] = true
		cfg.DeviceIDs = append(cfg.DeviceIDs, id)
	}
	return cfg, nil
}

func (s *Service) prepareAdminBundle(ctx context.Context, input CreateInput) ([]byte, error) {
	if input.ResourceType != "device_batch" {
		return nil, apperr.New(apperr.KindInvalidArgument, "批量导出需要 device_batch 资源类型")
	}
	cfg, err := parseAdminBundleConfig(input.RequestConfig)
	if err != nil {
		return nil, err
	}
	if cfg.DeviceIDs[0] != input.ResourceID {
		return nil, apperr.New(apperr.KindInvalidArgument, "批量导出的首台设备不匹配")
	}
	for i, part := range cfg.Parts {
		var requested map[string]any
		if err := json.Unmarshal(part.RequestConfig, &requested); err != nil || requested == nil {
			return nil, apperr.New(apperr.KindInvalidArgument, fmt.Sprintf("第 %d 台设备缺少导出参数", i+1))
		}
		requested["start_time"] = cfg.StartTime.UTC()
		requested["end_time"] = cfg.EndTime.UTC()
		delete(requested, "data_phase")
		raw, err := json.Marshal(requested)
		if err != nil {
			return nil, err
		}
		prepared, err := s.prepareAdminExport(ctx, CreateInput{ResourceType: part.ResourceType, ResourceID: part.ResourceID, ExportType: part.ExportType, RequestConfig: raw})
		if err != nil {
			return nil, apperr.Wrap(apperr.KindOf(err), fmt.Sprintf("第 %d 台设备：%s", i+1, apperr.MessageOf(err)), err)
		}
		cfg.Parts[i].RequestConfig = prepared
	}
	return json.Marshal(cfg)
}
