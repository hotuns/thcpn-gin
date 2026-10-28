package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
	lorawanv2 "thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (h *Handler) DeviceLoRaWANV2TimeConfig(c *gin.Context) { h.deviceLoRaWANV2TimeConfig(c, false) }
func (h *Handler) AdminDeviceLoRaWANV2TimeConfig(c *gin.Context) {
	h.deviceLoRaWANV2TimeConfig(c, true)
}
func (h *Handler) deviceLoRaWANV2TimeConfig(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, "device.view") {
		return
	}
	index, err := strconv.Atoi(c.Param("node_index"))
	if err != nil || index < 1 || index > 254 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid node index"))
		return
	}
	asset, err := device.NewService(h.service.DB).GetAsset(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if int64(index) > asset.ChildCount {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "node index outside gateway range"))
		return
	}
	ref, err := h.service.LoRaWAN.LoRaWANV2GatewayForDevice(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	path := "/device/" + url.PathEscape(ref.GatewaySN) + "/node/" + strconv.Itoa(index) + "/time_config"
	if configID := c.Param("config_id"); configID != "" {
		if _, err := strconv.ParseUint(configID, 10, 64); err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid configuration ID"))
			return
		}
		path += "/" + configID
	} else if strings.HasSuffix(c.FullPath(), "time-configs") {
		path += "s"
	} else {
		path += "/latest"
	}
	payload, err := h.service.LoRaWAN.LoRaWANV2Request(c.Request.Context(), ref.DataSourceID, http.MethodGet, path, nil, nil)
	if errors.Is(err, lorawanv2.ErrLoRaWANV2SensorConfigNotFound) && strings.HasSuffix(path, "/latest") {
		writeLoRaWANV2Payload(c, http.StatusOK, json.RawMessage("null"))
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	writeLoRaWANV2Payload(c, http.StatusOK, payload)
}
func (h *Handler) DeviceLoRaWANV2Info(c *gin.Context)      { h.deviceLoRaWANV2Info(c, false) }
func (h *Handler) AdminDeviceLoRaWANV2Info(c *gin.Context) { h.deviceLoRaWANV2Info(c, true) }
func (h *Handler) deviceLoRaWANV2Info(c *gin.Context, admin bool) {
	id, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !admin && !h.authorize(c, "device", id, "device.view") {
		return
	}
	payload, err := h.service.latestLoRaWANV2Info(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	writeLoRaWANV2Payload(c, http.StatusOK, payload)
}

func (s *Service) latestLoRaWANV2Info(ctx context.Context, id uuid.UUID) (json.RawMessage, error) {
	return s.LoRaWAN.ReadLatestGatewayInfo(ctx, id)
}
