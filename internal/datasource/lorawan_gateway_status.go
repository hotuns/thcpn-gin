package datasource

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"thcpn-gin/internal/httpx"
)

func (h *Handler) DeviceLoRaWANV2Connection(c *gin.Context) { h.gatewayConnection(c, false) }
func (h *Handler) AdminLoRaWANV2Connection(c *gin.Context)  { h.gatewayConnection(c, true) }
func (h *Handler) gatewayConnection(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, "device.view") {
		return
	}
	result, err := h.service.LoRaWAN.ReadGatewayConnection(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) DeviceLoRaWANV2Activity(c *gin.Context) { h.gatewayActivity(c, false) }
func (h *Handler) AdminLoRaWANV2Activity(c *gin.Context)  { h.gatewayActivity(c, true) }
func (h *Handler) gatewayActivity(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, "device.view") {
		return
	}
	result, err := h.service.LoRaWAN.ReadGatewayActivity(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
