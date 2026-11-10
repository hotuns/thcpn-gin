package datasource

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/httpx"

	"github.com/gin-gonic/gin"
)

type updateCaptureConfigRequest struct {
	ExpectedVersion int64                          `json:"expected_version"`
	RiskConfirmed   bool                           `json:"risk_confirmed"`
	Changes         []platform.CaptureConfigChange `json:"changes"`
}

type captureConfigSaveResult struct {
	Version    int64                      `json:"version"`
	WriteState *platform.ConfigWriteState `json:"write_state"`
	Warnings   []platform.QueryWarning    `json:"warnings,omitempty"`
}

func (h *Handler) captureConfigTarget(c *gin.Context) (device.Device, auth.Actor, bool) {
	actor, ok := actorFromContext(c)
	if !ok {
		return device.Device{}, actor, false
	}
	if actor.IsDemo {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "演示账号不能修改真实设备的采集配置"))
		return device.Device{}, actor, false
	}
	id, ok := parseUUIDParam(c, "device_id")
	if !ok || !h.authorize(c, "device", id, bindingManageAction) {
		return device.Device{}, actor, false
	}
	item, err := device.NewService(h.service.DB).GetAsset(c.Request.Context(), id)
	if err == nil && (item.Status != "active" || item.SourceStatus != "active" || item.DeviceType == "camera") {
		err = apperr.New(apperr.KindInvalidArgument, "当前设备不支持修改采集配置")
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return device.Device{}, actor, false
	}
	return item, actor, true
}

func (h *Handler) GetCaptureConfig(c *gin.Context) {
	item, _, ok := h.captureConfigTarget(c)
	if !ok {
		return
	}
	result, err := h.service.GetCaptureConfig(c.Request.Context(), item.ID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateCaptureConfig(c *gin.Context) {
	item, actor, ok := h.captureConfigTarget(c)
	if !ok {
		return
	}
	var request updateCaptureConfigRequest
	if err := readCaptureConfigRequest(c, &request, &request.RiskConfirmed); err != nil {
		h.writeCaptureConfigResult(c, item, actor, "device.config.capture.update", "", captureConfigSaveResult{}, err)
		return
	}
	result, err := h.service.UpdateCaptureConfig(c.Request.Context(), item.ID, actor.UserID, request.ExpectedVersion, request.Changes)
	info := fmt.Sprintf("old_version=%d; sections=%s", request.ExpectedVersion, strings.Join(result.Audit.ChangedSections, ","))
	h.writeCaptureConfigResult(c, item, actor, "device.config.capture.update", info, captureConfigSaveResult{Version: result.Config.ID, WriteState: result.WriteState, Warnings: result.Warnings}, err)
}

func (h *Handler) NodeCaptureConfig(c *gin.Context) {
	item, actor, ok := h.captureConfigTarget(c)
	if !ok {
		return
	}
	index, parseErr := strconv.Atoi(c.Param("node_index"))
	if parseErr != nil || index < 1 || index > 254 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "节点序号必须在 1–254 之间"))
		return
	}
	if item.SourceFamily != platform.SourceFamilyLoRaWANV2 || item.DeviceType != "gateway" {
		httpx.WriteAppError(c, unsupportedCapability())
		return
	}
	ctx := c.Request.Context()
	if c.Request.Method == http.MethodGet {
		result, err := h.service.LoRaWAN.GetWorkspaceSensorConfig(ctx, item.ID, index)
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusOK, result)
		return
	}
	const action = "device.config.node_sensor.update"
	var request struct {
		lorawanv2.WorkspaceSensorConfigUpdate
		RiskConfirmed bool `json:"risk_confirmed"`
	}
	info := fmt.Sprintf("node_index=%d", index)
	if err := readCaptureConfigRequest(c, &request, &request.RiskConfirmed); err != nil {
		h.writeCaptureConfigResult(c, item, actor, action, info, captureConfigSaveResult{}, err)
		return
	}
	result, err := h.service.LoRaWAN.UpdateWorkspaceSensorConfig(ctx, item.ID, actor.UserID, index, request.WorkspaceSensorConfigUpdate)
	var source struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(result.Payload, &source)
	h.writeCaptureConfigResult(c, item, actor, action, info, captureConfigSaveResult{Version: source.ID, WriteState: result.WriteState, Warnings: result.Warnings}, err)
}

func readCaptureConfigRequest(c *gin.Context, request any, confirmed *bool) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(request); err != nil || decoder.Decode(new(any)) != io.EOF {
		return apperr.New(apperr.KindInvalidArgument, "采集配置请求格式不正确")
	}
	if !*confirmed {
		return apperr.New(apperr.KindInvalidArgument, "请先确认配置错误可能导致设备失控的风险")
	}
	return nil
}

func (h *Handler) writeCaptureConfigResult(c *gin.Context, item device.Device, actor auth.Actor, action, reason string, result captureConfigSaveResult, err error) {
	status := audit.ResultSuccess
	if err != nil {
		status = audit.ResultFailure
		reason = apperr.MessageOf(err)
	} else if result.WriteState != nil {
		reason += fmt.Sprintf("; version=%d; source=%s; platform=%s", result.Version, result.WriteState.Source, result.WriteState.Platform)
	}
	if !h.record(c, audit.RecordInput{WorkspaceID: item.WorkspaceID, ActorType: audit.ActorUser, ActorID: audit.UserActorID(actor.UserID), Action: action, ResourceType: "device", ResourceID: audit.ResourceID(item.ID), Result: status, Reason: reason}) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
