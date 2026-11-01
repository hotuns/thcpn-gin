package deviceprofile

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type GatewayDetails struct {
	AppKey   string `json:"app_key"`
	EUI      string `json:"eui"`
	WiFiName string `json:"wifi_name"`
}

func (s *Service) GatewayDetails(ctx context.Context, id uuid.UUID) (GatewayDetails, error) {
	var result GatewayDetails
	err := s.db.QueryRow(ctx, `SELECT COALESCE(g.app_key,''),COALESCE(g.eui,''),COALESCE(g.wifi_name,'')
 FROM devices d JOIN device_source_refs r ON r.device_id=d.id AND r.status='active'
 JOIN data_sources s ON s.id=r.data_source_id AND s.source_family='lorawan_v2'
 LEFT JOIN lorawan_gateway_details g ON g.device_id=d.id
 WHERE d.id=$1 AND d.device_type='gateway' LIMIT 1`, id).Scan(&result.AppKey, &result.EUI, &result.WiFiName)
	if err != nil {
		return result, mapNotFound(err, "LoRaWAN V2 gateway not found")
	}
	return result, nil
}
func (s *Service) SaveGatewayDetails(ctx context.Context, id, actor uuid.UUID, input GatewayDetails) (GatewayDetails, error) {
	if _, err := s.GatewayDetails(ctx, id); err != nil {
		return GatewayDetails{}, err
	}
	input.AppKey = strings.TrimSpace(input.AppKey)
	input.EUI = strings.TrimSpace(input.EUI)
	input.WiFiName = strings.TrimSpace(input.WiFiName)
	for _, value := range []string{input.AppKey, input.EUI, input.WiFiName} {
		if utf8.RuneCountInString(value) > 128 {
			return GatewayDetails{}, apperr.New(apperr.KindInvalidArgument, "扩展信息每项最多128个字符")
		}
	}
	_, err := s.db.Exec(ctx, `INSERT INTO lorawan_gateway_details(device_id,app_key,eui,wifi_name,updated_by) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(device_id) DO UPDATE SET app_key=$2,eui=$3,wifi_name=$4,updated_by=$5,updated_at=now()`, id, input.AppKey, input.EUI, input.WiFiName, actor)
	if err != nil {
		return GatewayDetails{}, err
	}
	return input, nil
}
func (h *Handler) GatewayDetails(c *gin.Context) {
	id, _, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	result, err := h.service.GatewayDetails(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) SaveGatewayDetails(c *gin.Context) {
	// Reject user writes before checking device permissions or accepting content.
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "authentication required"))
		return
	}
	if !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "administrator required"))
		return
	}
	id, _, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var input GatewayDetails
	if err := c.ShouldBindJSON(&input); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid gateway details"))
		return
	}
	result, err := h.service.SaveGatewayDetails(c.Request.Context(), id, actor.UserID, input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, id, "device.gateway_details.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, result)
}
