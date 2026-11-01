package datasource

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/httpx"
)

// Inventory operations are administrative; all source paths are selected here.
func (h *Handler) AdminLoRaWANPhysicalNodes(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	ref, err := h.service.LoRaWAN.LoRaWANV2GatewayForDevice(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if c.Request.Method == http.MethodGet {
		if c.Query("inventory") == "true" {
			q := loraWANV2PageQueryFromContext(c)
			for _, key := range []string{"sn", "bound"} {
				if c.Query(key) != "" {
					q.Set(key, c.Query(key))
				}
			}
			raw, err := h.service.LoRaWAN.LoRaWANV2Request(c.Request.Context(), ref.DataSourceID, http.MethodGet, "/nodes", q, nil)
			if err != nil {
				httpx.WriteAppError(c, err)
				return
			}
			writeLoRaWANV2Payload(c, 200, raw)
			return
		}
		result, err := h.service.LoRaWAN.SyncPhysicalNodes(c.Request.Context(), id)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(200, result)
		return
	}
	var input lorawanv2.PhysicalNodeCommand
	if c.ShouldBindJSON(&input) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid node request"))
		return
	}
	result, err := h.service.LoRaWAN.OperatePhysicalNode(c.Request.Context(), id, actor.UserID, input)
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "lorawan_v2.node."+input.Action, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.recordLoRaWANV2(c, actor.UserID, ref.DataSourceID, "lorawan_v2.node."+input.Action, audit.ResultSuccess, "gateway="+ref.GatewaySN+"; node="+input.SN+"; operation="+result.OperationID.String()) {
		return
	}
	c.JSON(200, result)
}
