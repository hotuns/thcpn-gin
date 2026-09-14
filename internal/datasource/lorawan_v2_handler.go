package datasource

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type createLoRaWANV2GatewayRequest struct {
	SN        string `json:"sn"`
	NodeCount int    `json:"node_count"`
}

func (h *Handler) AdminLoRaWANV2Health(c *gin.Context) {
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	payload, err := h.service.LoRaWANV2Health(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	writeLoRaWANV2Payload(c, http.StatusOK, payload)
}

func (h *Handler) AdminListLoRaWANV2Gateways(c *gin.Context) {
	h.adminLoRaWANV2Get(c, "/devices", loraWANV2PageQueryFromContext(c))
}

func (h *Handler) AdminCreateLoRaWANV2Gateway(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	var req createLoRaWANV2GatewayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.CreateLoRaWANV2Gateway(c.Request.Context(), id, req.SN, req.NodeCount, actor.UserID)
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.create", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	status, reason := audit.ResultSuccess, "gateway_sn="+result.Gateway.SN
	if result.SyncError != "" {
		status, reason = audit.ResultFailure, reason+"; sync_error="+result.SyncError
	}
	if !h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.create", status, reason) {
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AdminGetLoRaWANV2Gateway(c *gin.Context) { h.adminLoRaWANV2GatewayGet(c, "") }

func (h *Handler) AdminSyncLoRaWANV2Gateway(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	sn, err := loraWANV2PathSN(c.Param("gateway_sn"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	result, err := h.service.SyncLoRaWANV2Gateway(c.Request.Context(), SyncLoRaWANV2GatewayInput{DataSourceID: id, GatewaySN: sn, ActorUserID: actor.UserID})
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.sync", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.sync", audit.ResultSuccess, "gateway_sn="+sn) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminSyncAllLoRaWANV2Gateways(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	result, err := h.service.SyncAllLoRaWANV2Gateways(c.Request.Context(), SyncAllLoRaWANV2GatewaysInput{DataSourceID: id, ActorUserID: actor.UserID})
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.sync_all", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.recordLoRaWANV2(c, actor.UserID, id, "lorawan_v2.gateway.sync_all", audit.ResultSuccess, fmt.Sprintf("total=%d; synced=%d; created=%d; updated=%d; failed=%d", result.Total, result.Synced, result.Created, result.Updated, result.Failed)) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminListLoRaWANV2Firmwares(c *gin.Context) {
	h.adminLoRaWANV2Get(c, "/firmwares", loraWANV2FirmwareQuery(c))
}
func (h *Handler) AdminCreateLoRaWANV2Firmware(c *gin.Context) {
	h.adminLoRaWANV2GatewayWrite(c, "/firmware", "lorawan_v2.firmware.create", http.StatusCreated)
}
func (h *Handler) AdminGetLoRaWANV2Firmware(c *gin.Context) {
	h.adminLoRaWANV2Get(c, "/firmware/"+url.PathEscape(c.Param("firmware_id")), url.Values{})
}
func (h *Handler) AdminDeleteLoRaWANV2Firmware(c *gin.Context) {
	h.adminLoRaWANV2Write(c, http.MethodDelete, "/firmware/"+url.PathEscape(c.Param("firmware_id")), nil, "lorawan_v2.firmware.delete", http.StatusOK)
}
func (h *Handler) AdminListLoRaWANV2GatewayConfigs(c *gin.Context) {
	h.adminLoRaWANV2GatewayGet(c, "/configs")
}
func (h *Handler) AdminCreateLoRaWANV2GatewayConfig(c *gin.Context) {
	h.adminLoRaWANV2GatewayWrite(c, "/config", "lorawan_v2.gateway_config.create", http.StatusCreated)
}
func (h *Handler) AdminGetLoRaWANV2GatewayConfig(c *gin.Context) {
	h.adminLoRaWANV2GatewayGet(c, "/config/"+url.PathEscape(c.Param("config_id")))
}
func (h *Handler) AdminListLoRaWANV2NodeSensorConfigs(c *gin.Context) {
	h.adminLoRaWANV2NodeGet(c, "/sensor_configs")
}
func (h *Handler) AdminCreateLoRaWANV2NodeSensorConfig(c *gin.Context) {
	h.adminLoRaWANV2NodeWrite(c, "/sensor_config", "lorawan_v2.node_sensor_config.create", http.StatusCreated)
}
func (h *Handler) AdminGetLatestLoRaWANV2NodeSensorConfig(c *gin.Context) {
	h.adminLoRaWANV2NodeGet(c, "/sensor_config/latest")
}
func (h *Handler) AdminGetLoRaWANV2NodeSensorConfig(c *gin.Context) {
	h.adminLoRaWANV2NodeGet(c, "/sensor_config/"+url.PathEscape(c.Param("config_id")))
}
func (h *Handler) AdminCreateLoRaWANV2NodeTimeConfig(c *gin.Context) {
	h.adminLoRaWANV2NodeWrite(c, "/time_config", "lorawan_v2.node_time_config.create", http.StatusOK)
}
func (h *Handler) AdminListLoRaWANV2GatewayLogs(c *gin.Context) {
	h.adminLoRaWANV2GatewayGet(c, "/logs")
}
func (h *Handler) AdminListLoRaWANV2NodeData(c *gin.Context) { h.adminLoRaWANV2NodeGet(c, "/data") }
func (h *Handler) AdminListLoRaWANV2GatewayInfos(c *gin.Context) {
	h.adminLoRaWANV2GatewayGet(c, "/infos")
}

func (h *Handler) adminLoRaWANV2GatewayGet(c *gin.Context, suffix string) {
	sn, err := loraWANV2PathSN(c.Param("gateway_sn"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.adminLoRaWANV2Get(c, "/device/"+url.PathEscape(sn)+suffix, loraWANV2AllowedQuery(c))
}
func (h *Handler) adminLoRaWANV2NodeGet(c *gin.Context, suffix string) {
	path, ok := h.loraWANV2NodePath(c, suffix)
	if !ok {
		return
	}
	h.adminLoRaWANV2Get(c, path, loraWANV2AllowedQuery(c))
}
func (h *Handler) adminLoRaWANV2GatewayWrite(c *gin.Context, suffix, action string, status int) {
	sn, err := loraWANV2PathSN(c.Param("gateway_sn"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.adminLoRaWANV2Write(c, http.MethodPost, "/device/"+url.PathEscape(sn)+suffix, loraWANV2JSONBody(c), action, status)
}
func (h *Handler) adminLoRaWANV2NodeWrite(c *gin.Context, suffix, action string, status int) {
	path, ok := h.loraWANV2NodePath(c, suffix)
	if !ok {
		return
	}
	h.adminLoRaWANV2Write(c, http.MethodPost, path, loraWANV2JSONBody(c), action, status)
}

func (h *Handler) loraWANV2NodePath(c *gin.Context, suffix string) (string, bool) {
	sn, err := loraWANV2PathSN(c.Param("gateway_sn"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return "", false
	}
	index, err := strconv.Atoi(c.Param("node_index"))
	if err != nil || index < 1 || index > 255 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "node_index must be between 1 and 255"))
		return "", false
	}
	return "/device/" + url.PathEscape(sn) + "/node/" + strconv.Itoa(index) + suffix, true
}

func (h *Handler) adminLoRaWANV2Get(c *gin.Context, path string, query url.Values) {
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	payload, err := h.service.LoRaWANV2Request(c.Request.Context(), id, http.MethodGet, path, query, nil)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	writeLoRaWANV2Payload(c, http.StatusOK, payload)
}
func (h *Handler) adminLoRaWANV2Write(c *gin.Context, method, path string, body any, action string, status int) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	id, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	if body == nil && method != http.MethodDelete {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	payload, err := h.service.LoRaWANV2Request(c.Request.Context(), id, method, path, url.Values{}, body)
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, id, action, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.recordLoRaWANV2(c, actor.UserID, id, action, audit.ResultSuccess, "") {
		return
	}
	writeLoRaWANV2Payload(c, status, payload)
}

func loraWANV2JSONBody(c *gin.Context) any {
	var raw json.RawMessage
	if err := c.ShouldBindJSON(&raw); err != nil || !json.Valid(raw) {
		return nil
	}
	var value any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	return value
}
func writeLoRaWANV2Payload(c *gin.Context, status int, payload json.RawMessage) {
	c.Data(status, "application/json; charset=utf-8", payload)
}
func (h *Handler) recordLoRaWANV2(c *gin.Context, actorID, sourceID uuid.UUID, action string, result string, reason string) bool {
	return h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID), Action: action, ResourceType: "data_source", ResourceID: audit.ResourceID(sourceID), Result: result, Reason: reason})
}

func loraWANV2AllowedQuery(c *gin.Context) url.Values {
	query := loraWANV2PageQueryFromContext(c)
	for _, key := range []string{"start_at", "end_at", "metrics"} {
		if value := strings.TrimSpace(c.Query(key)); value != "" {
			query.Set(key, value)
		}
	}
	return query
}
func loraWANV2PageQueryFromContext(c *gin.Context) url.Values {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
	return loraWANV2PageQuery(page, size)
}
func loraWANV2FirmwareQuery(c *gin.Context) url.Values {
	query := loraWANV2PageQueryFromContext(c)
	if sn := strings.TrimSpace(c.Query("device_sn")); sn != "" {
		query.Set("device_sn", sn)
	}
	return query
}
