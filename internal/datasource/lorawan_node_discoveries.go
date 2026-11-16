package datasource

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

// Discovery is a device-side fact. The platform scopes it to this gateway;
// confirmation uses the existing audited physical-node operations.
func (h *Handler) AdminLoRaWANNodeDiscoveries(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return
	}
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	page, err := strconv.Atoi(c.DefaultQuery("page", "1"))
	if err != nil || page < 1 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "页码必须为大于 0 的整数"))
		return
	}
	pageSize, err := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if err != nil || pageSize < 1 || pageSize > 50 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "每页数量必须为 1～50 的整数"))
		return
	}
	payload, err := h.service.LoRaWAN.ListPendingNodeDiscoveries(c.Request.Context(), id, page, pageSize)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	writeLoRaWANV2Payload(c, http.StatusOK, payload)
}
