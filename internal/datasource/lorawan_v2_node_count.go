package datasource

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

func (h *Handler) AdminUpdateLoRaWANV2NodeCount(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var request struct {
		NodeCount int `json:"node_count"`
	}
	if err := c.ShouldBindJSON(&request); err != nil || request.NodeCount < 1 || request.NodeCount > 254 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "node_count must be an integer between 1 and 254"))
		return
	}
	ref, err := h.service.LoRaWAN.LoRaWANV2GatewayForDevice(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	result, err := h.service.LoRaWAN.UpdateNodeCount(c.Request.Context(), id, actor.UserID, request.NodeCount)
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "lorawan_v2.node_count.update", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	auditResult := audit.ResultSuccess
	if result.Status != "completed" {
		auditResult = audit.ResultFailure
	}
	if !h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "lorawan_v2.node_count.update", auditResult, fmt.Sprintf("device_id=%s; gateway_sn=%s; node_count=%d; operation_id=%s; source=%s; platform=%s", id, ref.GatewaySN, result.Gateway.NodeCount, result.WriteState.OperationID, result.WriteState.Source, result.WriteState.Platform)) {
		return
	}
	c.JSON(http.StatusOK, result)
}
