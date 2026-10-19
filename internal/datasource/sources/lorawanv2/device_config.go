package lorawanv2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"

	"github.com/google/uuid"
)

type ConfigRequest struct {
	NodeIndex int
	Latest    bool
	DeviceID  uuid.UUID
	ActorID   uuid.UUID
	Kind      string
	Method    string
	Query     url.Values
	Body      any
}
type ConfigResult struct {
	DataSourceID uuid.UUID
	Payload      json.RawMessage
	WriteState   *platform.ConfigWriteState
	Warnings     []platform.QueryWarning
	Status       string
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
		if index < 1 || index > int(item.ChildCount) {
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
	var body any
	var compiled *loraWANV2CompiledConfig
	nodeIndex := 0
	if request.Method == http.MethodPost {
		if item.Status != "active" {
			return response, apperr.New(apperr.KindInvalidArgument, "device is disabled")
		}
		body = request.Body
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
			nodeIndex = request.NodeIndex
			item, compileErr := s.compileLoRaWANV2NodeConfig(ctx, body)
			if compileErr != nil {
				return response, compileErr
			}
			compiled = &item
			body = map[string]any{"wait_time": item.WaitTime, "content": item.Content}
		}
	}
	if request.Method == http.MethodGet {
		payload, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodGet, path, request.Query, nil)
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
	payload, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, http.MethodPost, path, nil, body)
	if err != nil {
		_ = s.FinishSourceOperation(operationID, "unknown", state, err)
		return response, apperr.Wrap(apperr.KindDataSource, "配置提交结果未知，请读取源端配置核对；操作 "+operationID.String(), err)
	}
	state.Source = "accepted"
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
		warnings = append(warnings, platform.QueryWarning{Code: "platform_sync_failed", Message: "源端已接受，平台同步失败；请重新同步平台。"})
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
