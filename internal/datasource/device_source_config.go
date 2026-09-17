package datasource

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/url"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"
)

// Device-facing configuration resolves upstream addresses inside the service boundary.
func (h *Handler) AdminDeviceSourceConfig(c *gin.Context) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	item, err := device.NewService(h.service.db).GetAsset(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	ref, err := h.service.LoRaWANV2GatewayForDevice(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	kind := c.Param("config_kind")
	path := "/device/" + url.PathEscape(ref.GatewaySN)
	switch kind {
	case "gateway":
		path += "/config"
		if c.Request.Method == http.MethodGet {
			path += "s"
		}
	case "sensor", "time":
		index, err := strconv.Atoi(c.Query("node_index"))
		if err != nil || index < 1 || index > int(item.ChildCount) {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "node_index is outside gateway node range"))
			return
		}
		path += "/node/" + strconv.Itoa(index)
		if kind == "sensor" {
			path += "/sensor_config"
			if c.Request.Method == http.MethodGet && c.Query("latest") == "true" {
				path += "/latest"
			} else if c.Request.Method == http.MethodGet {
				path += "s"
			}
		} else {
			path += "/time_config"
			if c.Request.Method == http.MethodGet {
				httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "time configuration history is not supported"))
				return
			}
		}
	default:
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "unsupported configuration kind"))
		return
	}
	var body any
	var compiled *loraWANV2CompiledConfig
	nodeIndex := 0
	if c.Request.Method == http.MethodPost {
		if item.Status != "active" {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "device is disabled"))
			return
		}
		body = loraWANV2JSONBody(c)
		if body == nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
			return
		}
		if kind == "sensor" {
			nodeIndex, _ = strconv.Atoi(c.Query("node_index"))
			item, compileErr := h.service.compileLoRaWANV2NodeConfig(c.Request.Context(), body)
			if compileErr != nil {
				httpx.WriteAppError(c, compileErr)
				return
			}
			compiled = &item
			body = map[string]any{"wait_time": item.WaitTime, "content": item.Content}
		}
	}
	if c.Request.Method == http.MethodGet {
		payload, err := h.service.LoRaWANV2Request(c.Request.Context(), ref.DataSourceID, http.MethodGet, path, loraWANV2AllowedQuery(c), nil)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		if kind == "sensor" {
			index, _ := strconv.Atoi(c.Query("node_index"))
			payload, err = h.service.describeLoRaWANV2NodeConfig(c.Request.Context(), id, index, payload)
			if err != nil {
				httpx.WriteAppError(c, err)
				return
			}
		}
		writeLoRaWANV2Payload(c, http.StatusOK, payload)
		return
	}
	operationID, err := h.service.beginSourceOperation(c.Request.Context(), ref.DataSourceID, &id, "config_update", "running", map[string]any{"kind": kind, "node_index": c.Query("node_index"), "body": body}, actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	state := ConfigWriteState{OperationID: operationID, Source: "unknown", Platform: "pending", Device: "unknown"}
	payload, err := h.service.LoRaWANV2Request(c.Request.Context(), ref.DataSourceID, http.MethodPost, path, nil, body)
	if err != nil {
		_ = h.service.finishSourceOperation(operationID, "unknown", state, err)
		h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "device.config."+kind, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindDataSource, "配置提交结果未知，请读取源端配置核对；操作 "+operationID.String(), err))
		return
	}
	state.Source = "accepted"
	if compiled != nil {
		var upstream struct {
			ID int64 `json:"id"`
		}
		_ = json.Unmarshal(payload, &upstream)
		var upstreamID *int64
		if upstream.ID > 0 {
			upstreamID = &upstream.ID
		}
		if snapshotErr := h.service.saveLoRaWANV2NodeConfigSnapshot(c.Request.Context(), id, nodeIndex, upstreamID, *compiled, actor.UserID); snapshotErr != nil {
			_ = h.service.finishSourceOperation(operationID, "partial", state, snapshotErr)
			httpx.WriteAppError(c, snapshotErr)
			return
		}
	}
	_, syncErr := h.service.SyncLoRaWANV2Gateway(c.Request.Context(), SyncLoRaWANV2GatewayInput{DataSourceID: ref.DataSourceID, GatewaySN: ref.GatewaySN, ActorUserID: actor.UserID})
	status := "completed"
	state.Platform = "synced"
	if syncErr != nil {
		status = "partial"
		state.Platform = "failed"
	}
	recordErr := h.service.finishSourceOperation(operationID, status, state, syncErr)
	warnings := []QueryWarning{}
	if syncErr != nil {
		warnings = append(warnings, QueryWarning{Code: "platform_sync_failed", Message: "源端已接受，平台同步失败；请重新同步平台。"})
	}
	if recordErr != nil {
		warnings = append(warnings, QueryWarning{Code: "operation_record_failed", Message: "操作记录更新失败，请核对源端配置。"})
	}
	if !h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "device.config."+kind, audit.ResultSuccess, status) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"payload": payload, "write_state": state, "warnings": warnings})
}
