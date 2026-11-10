package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

type WorkspaceSensorConfig struct {
	Version  int64                     `json:"version"`
	NodeSN   string                    `json:"node_sn"`
	WaitTime int                       `json:"wait_time"`
	Content  []any                     `json:"content"`
	Metrics  []loraWANV2MetricSemantic `json:"metrics"`
}

type WorkspaceSensorConfigUpdate struct {
	ExpectedVersion *int64 `json:"expected_version"`
	NodeSN          string `json:"node_sn"`
	Mode            string `json:"mode"`
	WaitTime        *int   `json:"wait_time"`
	Content         []any  `json:"content"`
	Metrics         []any  `json:"metrics"`
}

func (s *Service) workspaceSensorNode(ctx context.Context, deviceID uuid.UUID, index int) (LoRaWANV2GatewayRef, string, error) {
	if index < 1 || index > 254 {
		return LoRaWANV2GatewayRef{}, "", apperr.New(apperr.KindInvalidArgument, "节点序号必须在 1–254 之间")
	}
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, deviceID)
	if err != nil {
		return ref, "", err
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, ref.DataSourceID)
	if err != nil {
		return ref, "", err
	}
	client, err := newLoRaWANV2Client(ctx, s.Runtime.Resolver, platform.DataSourceFromSQL(source))
	if err != nil {
		return ref, "", err
	}
	nodes, err := readPhysicalNodes(ctx, client, ref.GatewaySN)
	if err != nil {
		return ref, "", err
	}
	for _, node := range nodes.Data {
		if *node.NodeIndex == index {
			return ref, node.SN, nil
		}
	}
	return ref, "", apperr.New(apperr.KindNotFound, "该序号当前没有绑定节点")
}

func (s *Service) GetWorkspaceSensorConfig(ctx context.Context, deviceID uuid.UUID, index int) (WorkspaceSensorConfig, error) {
	ref, sn, err := s.workspaceSensorNode(ctx, deviceID, index)
	result := WorkspaceSensorConfig{NodeSN: sn, Content: []any{}, Metrics: []loraWANV2MetricSemantic{}}
	if err != nil {
		return result, err
	}
	path := "/device/" + url.PathEscape(ref.GatewaySN) + "/node/" + strconv.Itoa(index) + "/sensor_config"
	current, payload, err := s.latestNativeSensorConfig(ctx, ref.DataSourceID, path)
	if err != nil || current == nil {
		return result, err
	}
	result.Version, result.WaitTime, result.Content = current.ID, current.WaitTime, current.Content
	payload, err = s.describeLoRaWANV2NodeConfig(ctx, deviceID, index, payload)
	if err != nil {
		return result, err
	}
	var semantic struct {
		Metrics []loraWANV2MetricSemantic `json:"metrics"`
	}
	if err := json.Unmarshal(payload, &semantic); err != nil {
		return result, apperr.Wrap(apperr.KindDataSource, "读取节点指标配置失败", err)
	}
	if semantic.Metrics != nil {
		result.Metrics = semantic.Metrics
	}
	return result, nil
}

func (s *Service) UpdateWorkspaceSensorConfig(ctx context.Context, deviceID, actorID uuid.UUID, index int, input WorkspaceSensorConfigUpdate) (ConfigResult, error) {
	if input.ExpectedVersion == nil || *input.ExpectedVersion < 0 || input.NodeSN == "" || input.Metrics == nil {
		return ConfigResult{}, apperr.New(apperr.KindInvalidArgument, "请提供当前节点、配置版本和指标")
	}
	body := map[string]any{"mode": input.Mode, "metrics": input.Metrics}
	switch input.Mode {
	case "metrics":
		if input.Content != nil || input.WaitTime != nil {
			return ConfigResult{}, apperr.New(apperr.KindInvalidArgument, "仅修改指标时不能提交原生配置")
		}
	case "advanced":
		if input.WaitTime == nil || input.Content == nil {
			return ConfigResult{}, apperr.New(apperr.KindInvalidArgument, "请提供协议配置和等待时间")
		}
		body["content"], body["wait_time"] = input.Content, *input.WaitTime
	default:
		return ConfigResult{}, apperr.New(apperr.KindInvalidArgument, "不支持的节点传感器配置方式")
	}
	_, sn, err := s.workspaceSensorNode(ctx, deviceID, index)
	if err != nil {
		return ConfigResult{}, err
	}
	if sn != input.NodeSN {
		return ConfigResult{}, apperr.New(apperr.KindConflict, "该序号的绑定节点已更换，请重新读取后核对")
	}
	return s.ConfigureDevice(ctx, ConfigRequest{DeviceID: deviceID, ActorID: actorID, NodeIndex: index, Kind: "sensor", Method: http.MethodPost, Body: body, ExpectedConfigID: input.ExpectedVersion})
}
