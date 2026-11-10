package lorawanv2

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"

	"github.com/google/uuid"
)

type ConfigRequest struct {
	NodeIndex        int
	Latest           bool
	DeviceID         uuid.UUID
	ActorID          uuid.UUID
	Kind             string
	Method           string
	Query            url.Values
	Body             any
	ExpectedConfigID *int64
}
type ConfigResult struct {
	DataSourceID uuid.UUID
	Payload      json.RawMessage
	WriteState   *platform.ConfigWriteState
	Warnings     []platform.QueryWarning
	Status       string
}

type nativeSensorConfig struct {
	ID       int64 `json:"id,omitempty"`
	WaitTime int   `json:"wait_time"`
	Content  []any `json:"content"`
}

func (config nativeSensorConfig) sameSettings(other nativeSensorConfig) bool {
	return config.WaitTime == other.WaitTime && platform.JsonSemanticallyEqual(platform.MustJSON(config.Content), platform.MustJSON(other.Content))
}

func (s *Service) latestNativeSensorConfig(ctx context.Context, sourceID uuid.UUID, path string) (*nativeSensorConfig, json.RawMessage, error) {
	payload, err := s.LoRaWANV2Request(ctx, sourceID, http.MethodGet, path+"/latest", nil, nil)
	if errors.Is(err, ErrLoRaWANV2SensorConfigNotFound) {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, apperr.Wrap(apperr.KindDataSource, "无法核对该节点的源端传感器配置，本次未下发", err)
	}
	var config nativeSensorConfig
	if json.Unmarshal(payload, &config) != nil || config.ID <= 0 || config.Content == nil || config.WaitTime < 0 || config.WaitTime > 65535 {
		return nil, nil, apperr.New(apperr.KindDataSource, "源端返回的节点传感器配置无效，本次未下发")
	}
	return &config, payload, nil
}

// SaveNativeSensorConfig handles the source console, where there are no platform metric definitions.
func (s *Service) SaveNativeSensorConfig(ctx context.Context, sourceID uuid.UUID, path string, body any) (json.RawMessage, bool, error) {
	var proposed struct {
		WaitTime *uint16 `json:"wait_time"`
		Content  []any   `json:"content"`
	}
	if err := json.Unmarshal(platform.MustJSON(body), &proposed); err != nil || proposed.Content == nil || proposed.WaitTime == nil {
		return nil, false, apperr.New(apperr.KindInvalidArgument, "invalid native node sensor configuration")
	}
	current, payload, err := s.latestNativeSensorConfig(ctx, sourceID, path)
	if err != nil {
		return nil, false, err
	}
	if current != nil && current.sameSettings(nativeSensorConfig{WaitTime: int(*proposed.WaitTime), Content: proposed.Content}) {
		return payload, false, nil
	}
	payload, err = s.LoRaWANV2Request(ctx, sourceID, http.MethodPost, path, nil, body)
	return payload, err == nil, err
}

func (s *Service) prepareNodeSensorUpdate(ctx context.Context, sourceID uuid.UUID, path string, body any, expectedConfigID *int64) (loraWANV2CompiledConfig, json.RawMessage, error) {
	var compiled loraWANV2CompiledConfig
	input, _ := body.(map[string]any)
	metricsOnly := platform.StringValue(input["mode"]) == "metrics"
	if metricsOnly {
		for field := range input {
			if field != "mode" && field != "metrics" {
				return compiled, nil, apperr.New(apperr.KindInvalidArgument, "只保存平台指标时不能同时提交原生配置或模板")
			}
		}
	} else {
		var err error
		compiled, err = s.compileLoRaWANV2NodeConfig(ctx, body)
		if err != nil {
			return compiled, nil, err
		}
	}
	current, latest, err := s.latestNativeSensorConfig(ctx, sourceID, path)
	if err != nil {
		return compiled, nil, err
	}
	if expectedConfigID != nil {
		var currentID int64
		if current != nil {
			currentID = current.ID
		}
		if currentID != *expectedConfigID {
			return compiled, nil, apperr.New(apperr.KindConflict, "节点传感器配置已变更，请重新读取后核对")
		}
	}
	if metricsOnly {
		if current == nil {
			return compiled, nil, apperr.New(apperr.KindInvalidArgument, "该节点尚无原生传感器配置，无法只保存平台指标")
		}
		compiled, err = s.compileLoRaWANV2NodeConfig(ctx, map[string]any{
			"mode": "advanced", "content": current.Content, "wait_time": current.WaitTime, "metrics": input["metrics"],
		})
		if err != nil {
			return compiled, nil, apperr.Wrap(apperr.KindInvalidArgument, "平台指标无法应用到该节点，原生配置未改动："+apperr.MessageOf(err), err)
		}
		return compiled, latest, nil
	}
	if current != nil && current.sameSettings(nativeSensorConfig{WaitTime: compiled.WaitTime, Content: compiled.Content}) {
		return compiled, latest, nil
	}
	return compiled, nil, nil
}

// ConfigureDevice owns source paths, protocol compilation and source/platform write outcomes.
func (s *Service) ConfigureDevice(ctx context.Context, request ConfigRequest) (response ConfigResult, err error) {
	id := request.DeviceID
	if request.Method != http.MethodGet && request.Method != http.MethodPost {
		return response, apperr.New(apperr.KindInvalidArgument, "unsupported configuration method")
	}
	item, err := device.NewService(s.DB).GetAsset(ctx, id)
	if err != nil {
		return response, err
	}
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return response, err
	}
	response.DataSourceID = ref.DataSourceID
	kind := request.Kind
	path := "/device/" + url.PathEscape(ref.GatewaySN)
	switch kind {
	case "gateway":
		path += "/config"
		if request.Method == http.MethodGet {
			path += "s"
		}
	case "sensor", "time":
		index := request.NodeIndex
		if index < 1 || index > 254 {
			return response, apperr.New(apperr.KindInvalidArgument, "node_index is outside gateway node range")
		}
		path += "/node/" + strconv.Itoa(index)
		if kind == "sensor" {
			path += "/sensor_config"
			if request.Method == http.MethodGet && request.Latest {
				path += "/latest"
			} else if request.Method == http.MethodGet {
				path += "s"
			}
		} else {
			path += "/time_config"
			if request.Method == http.MethodGet {
				if request.Latest {
					path += "/latest"
				} else {
					path += "s"
				}
			}
		}
	default:
		return response, apperr.New(apperr.KindInvalidArgument, "unsupported configuration kind")
	}
	body := request.Body
	var compiled *loraWANV2CompiledConfig
	var unchangedPayload json.RawMessage
	if request.Method == http.MethodPost {
		if item.Status != "active" {
			return response, apperr.New(apperr.KindInvalidArgument, "device is disabled")
		}
		if body == nil {
			return response, apperr.New(apperr.KindInvalidArgument, "invalid request body")
		}
		if kind == "gateway" {
			body, err = NormalizeLoRaWANV2GatewayConfig(body, ref.GatewaySN)
			if err != nil {
				return response, err
			}
		}
		if kind == "sensor" {
			item, latest, compileErr := s.prepareNodeSensorUpdate(ctx, ref.DataSourceID, path, body, request.ExpectedConfigID)
			if compileErr != nil {
				return response, compileErr
			}
			compiled = &item
			unchangedPayload = latest
		}
	}
	if request.Method == http.MethodGet {
		payload, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, path, request.Query, nil)
		if kind == "sensor" && request.Latest && errors.Is(err, ErrLoRaWANV2SensorConfigNotFound) {
			response.Payload = json.RawMessage(`{}`)
			return response, nil
		}
		if err != nil {
			return response, err
		}
		if kind == "sensor" {
			index := request.NodeIndex
			payload, err = s.describeLoRaWANV2NodeConfig(ctx, id, index, payload)
			if err != nil {
				return response, err
			}
		}
		response.Payload = payload
		return response, nil
	}
	operationID, err := s.BeginSourceOperation(ctx, ref.DataSourceID, &id, "config_update", "running", map[string]any{"kind": kind, "node_index": request.NodeIndex, "body": body}, request.ActorID)
	if err != nil {
		return response, err
	}
	state := platform.ConfigWriteState{OperationID: operationID, Source: "unknown", Platform: "pending", Device: "unknown"}
	payload := unchangedPayload
	if unchangedPayload != nil {
		state.Source, state.Device = "unchanged", "not_sent"
	} else {
		nativeBody := body
		if compiled != nil {
			nativeBody = nativeSensorConfig{WaitTime: compiled.WaitTime, Content: compiled.Content}
		}
		payload, err = s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodPost, path, nil, nativeBody)
		if err != nil {
			_ = s.FinishSourceOperation(operationID, "unknown", state, err)
			return response, apperr.Wrap(apperr.KindDataSource, "配置提交结果未知，请读取源端配置核对；操作 "+operationID.String(), err)
		}
		state.Source = "accepted"
	}
	nodeIndex := request.NodeIndex
	var syncErr error
	if compiled != nil {
		var upstream struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(payload, &upstream)
		var upstreamID *int64
		if upstream.ID > 0 {
			upstreamID = &upstream.ID
		}
		if snapshotErr := s.saveLoRaWANV2NodeConfigSnapshot(ctx, id, nodeIndex, upstreamID, *compiled, request.ActorID); snapshotErr != nil {
			if state.Source == "unchanged" {
				state.Platform = "failed"
				_ = s.FinishSourceOperation(operationID, "failed", state, snapshotErr)
				return response, apperr.Wrap(apperr.KindInternal, "平台指标保存失败，原生配置未改动；请重试保存", snapshotErr)
			}
			syncErr = snapshotErr
		}
	}
	input := SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: request.ActorID}
	if syncErr == nil {
		if compiled != nil {
			syncErr = s.syncLoRaWANV2Node(ctx, input, nodeIndex)
		} else if kind != "time" {
			_, syncErr = s.SyncLoRaWANV2Gateway(ctx, input)
		}
	}
	status := "completed"
	state.Platform = "synced"
	if syncErr != nil {
		status = "partial"
		state.Platform = "failed"
	}
	recordErr := s.FinishSourceOperation(operationID, status, state, syncErr)
	warnings := []platform.QueryWarning{}
	if syncErr != nil {
		message := "源端已接受，平台同步失败；请重新同步平台。"
		if state.Source == "unchanged" {
			message = "指标资料已保存，平台指标同步失败；请重新同步平台。未下发设备配置。"
		}
		warnings = append(warnings, platform.QueryWarning{Code: "platform_sync_failed", Message: message})
	}
	if recordErr != nil {
		warnings = append(warnings, platform.QueryWarning{Code: "operation_record_failed", Message: "操作记录更新失败，请核对源端配置。"})
	}
	response.Payload = payload
	response.WriteState = &state
	response.Warnings = warnings
	response.Status = status
	return response, nil
}
