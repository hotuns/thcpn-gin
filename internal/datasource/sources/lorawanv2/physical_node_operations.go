package lorawanv2

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
)

type PhysicalNodeCommand struct {
	Action    string `json:"action"`
	SN        string `json:"sn"`
	NodeIndex int    `json:"node_index"`
}
type PhysicalNodeResult struct {
	Status      string          `json:"status"`
	Payload     json.RawMessage `json:"payload"`
	Message     string          `json:"message"`
	OperationID uuid.UUID       `json:"operation_id"`
}

func (s *Service) OperatePhysicalNode(ctx context.Context, id, actor uuid.UUID, input PhysicalNodeCommand) (PhysicalNodeResult, error) {
	var result PhysicalNodeResult
	if input.Action == "reconcile" {
		ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
		if err != nil {
			return result, err
		}
		_, err = s.SyncLoRaWANV2Gateway(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: actor})
		if err != nil {
			return result, err
		}
		result.Status = "completed"
		result.Message = "平台同步完成，未重复提交节点操作。"
		return result, nil
	}
	input.SN = strings.TrimSpace(input.SN)
	if actor == uuid.Nil || input.SN == "" || len(input.SN) > 64 {
		return result, apperr.New(apperr.KindInvalidArgument, "node SN and actor required (SN max 64 characters)")
	}
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return result, err
	}
	method, path, body := http.MethodPost, "/nodes", any(map[string]string{"sn": input.SN})
	switch input.Action {
	case "register":
	case "bind":
		method = http.MethodPut
		path = "/nodes/" + url.PathEscape(input.SN) + "/binding"
		body = map[string]any{"gateway_sn": ref.GatewaySN, "node_index": input.NodeIndex}
	case "unbind":
		method = http.MethodDelete
		path = "/nodes/" + url.PathEscape(input.SN) + "/binding"
		body = nil
	case "replace":
		path = "/device/" + url.PathEscape(ref.GatewaySN) + "/node/" + strconv.Itoa(input.NodeIndex) + "/replace"
		body = map[string]string{"new_node_sn": input.SN}
	default:
		return result, apperr.New(apperr.KindInvalidArgument, "unknown node operation")
	}
	if (input.Action == "bind" || input.Action == "replace") && (input.NodeIndex < 1 || input.NodeIndex > 254) {
		return result, apperr.New(apperr.KindInvalidArgument, "node_index must be between 1 and 254")
	}
	if input.Action == "unbind" {
		nodes, err := s.SyncPhysicalNodes(ctx, id)
		if err != nil {
			return result, err
		}
		found := false
		for _, n := range nodes.Data {
			if n.SN == input.SN {
				found = true
			}
		}
		if !found {
			return result, apperr.New(apperr.KindConflict, "节点当前不在此网关，请刷新")
		}
	}
	op, err := s.BeginSourceOperation(ctx, ref.DataSourceID, &id, "config_update", "running", input, actor)
	if err != nil {
		return result, err
	}
	result.OperationID = op
	raw, err := s.LoRaWANV2Request(ctx, ref.DataSourceID, method, path, nil, body)
	if err != nil {
		_ = s.FinishSourceOperation(op, "unknown", nil, err)
		return result, apperr.Wrap(apperr.KindDataSource, "节点操作结果未知，请先刷新核对；操作 "+op.String(), err)
	}
	result.Payload = raw
	var syncErr error
	if input.Action == "register" {
		syncErr = s.RememberRegisteredNode(ctx, ref.DataSourceID, raw)
	}
	if syncErr == nil {
		_, syncErr = s.SyncPhysicalNodes(ctx, id)
	}
	if syncErr == nil && (input.Action == "bind" || input.Action == "replace") {
		_, syncErr = s.SyncLoRaWANV2Gateway(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: actor})
	}
	result.Status = "completed"
	result.Message = "登记与绑定操作不发送硬件指令；配置和数据继续属于采集位置。"
	if syncErr != nil {
		result.Status = "partial"
		result.Message = "源端已接受，平台同步失败。请刷新核对，不要重复提交。"
	}
	if err := s.FinishSourceOperation(op, result.Status, result, syncErr); err != nil {
		result.Message += " 操作记录更新失败，请保留操作 ID 核对。"
	}
	return result, nil
}
