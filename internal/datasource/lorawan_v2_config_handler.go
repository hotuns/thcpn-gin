package datasource

import (
	"net/http"
	"strconv"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/httpx"

	"github.com/gin-gonic/gin"
)

func (h *Handler) AdminDeviceSourceConfig(c *gin.Context) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	var body any
	if c.Request.Method == http.MethodPost {
		body = loraWANV2JSONBody(c)
	}
	kind := c.Param("config_kind")
	index, _ := strconv.Atoi(c.Query("node_index"))
	result, err := h.service.LoRaWAN.ConfigureDevice(c.Request.Context(), lorawanv2.ConfigRequest{DeviceID: id, ActorID: actor.UserID, Kind: kind, NodeIndex: index, Latest: c.Query("latest") == "true", Method: c.Request.Method, Query: loraWANV2AllowedQuery(c), Body: body})
	if err != nil {
		if c.Request.Method == http.MethodPost {
			if !h.record(c, audit.RecordInput{ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: "device.config." + kind, ResourceType: "device", ResourceID: audit.ResourceID(id), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)}) {
				return
			}
		}
		httpx.WriteAppError(c, err)
		return
	}
	if c.Request.Method == http.MethodGet {
		writeLoRaWANV2Payload(c, http.StatusOK, result.Payload)
		return
	}
	if !h.recordLoRaWANV2(c, actor.UserID, result.DataSourceID, "device.config."+kind, audit.ResultSuccess, result.Status) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"payload": result.Payload, "write_state": result.WriteState, "warnings": result.Warnings})
}
