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

func (h *Handler) AdminLoRaWANNodeInventory(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	source, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	if c.Request.Method == http.MethodGet {
		q := loraWANV2PageQueryFromContext(c)
		for _, key := range []string{"sn", "bound", "gateway_sn"} {
			if c.Query(key) != "" {
				q.Set(key, c.Query(key))
			}
		}
		raw, err := h.service.LoRaWAN.LoRaWANV2Request(c.Request.Context(), source, http.MethodGet, "/nodes", q, nil)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		writeLoRaWANV2Payload(c, 200, raw)
		return
	}
	var input lorawanv2.NodeRegistration
	if c.ShouldBindJSON(&input) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid registration request"))
		return
	}
	result, err := h.service.LoRaWAN.RegisterPhysicalNode(c.Request.Context(), source, actor.UserID, input)
	if err != nil {
		h.recordLoRaWANV2(c, actor.UserID, source, "lorawan_v2.node.register_install", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	auditResult := audit.ResultSuccess
	if result.Status != "completed" {
		auditResult = audit.ResultFailure
	}
	if !h.recordLoRaWANV2(c, actor.UserID, source, "lorawan_v2.node.register_install", auditResult, "SN="+input.SN+"; operation="+result.OperationID.String()) {
		return
	}
	c.JSON(200, result)
}
func (h *Handler) AdminLoRaWANNodeGateways(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	source, ok := parseUUIDParam(c, "data_source_id")
	if !ok {
		return
	}
	items, err := h.service.LoRaWAN.NodeGateways(c.Request.Context(), source)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(200, gin.H{"items": items})
}
func (h *Handler) AdminPreviewLoRaWANNodeCSV(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	var input struct {
		CSV string `json:"csv"`
	}
	if c.ShouldBindJSON(&input) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "CSV 内容无效"))
		return
	}
	rows, err := lorawanv2.ParseNodeCSV(input.CSV)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(200, gin.H{"items": rows})
}
