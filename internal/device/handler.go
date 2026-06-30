package device

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const (
	deviceViewAction      = "device.view"
	deviceBindAction      = "device.bind"
	deviceConfigureAction = "device.configure"
	deviceCalibrateAction = "device.calibrate"
	deviceFirmwareAction  = "device.firmware_upgrade"
	deviceTransferAction  = "device.transfer"
	deviceUnbindAction    = "device.unbind"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type createDeviceRequest struct {
	WorkspaceID  string   `json:"workspace_id"`
	ProjectID    string   `json:"project_id"`
	SiteID       string   `json:"site_id"`
	ProductID    string   `json:"product_id"`
	SerialNo     string   `json:"serial_no"`
	Name         string   `json:"name"`
	Capabilities []string `json:"capabilities"`
}

type updateDeviceRequest struct {
	ProjectID    *string   `json:"project_id"`
	SiteID       *string   `json:"site_id"`
	ProductID    *string   `json:"product_id"`
	SerialNo     *string   `json:"serial_no"`
	Name         *string   `json:"name"`
	Status       *string   `json:"status"`
	Capabilities *[]string `json:"capabilities"`
}

type createCalibrationRequest struct {
	CalibrationType string          `json:"calibration_type"`
	Parameters      json.RawMessage `json:"parameters"`
}

type createFirmwareUpgradeRequest struct {
	FirmwareVersion string     `json:"firmware_version"`
	PackageURI      string     `json:"package_uri"`
	Checksum        string     `json:"checksum"`
	ScheduledAt     *time.Time `json:"scheduled_at"`
}

type transferDeviceRequest struct {
	TargetWorkspaceID          string `json:"target_workspace_id"`
	ProjectID                  string `json:"project_id"`
	SiteID                     string `json:"site_id"`
	TransferHistoricalDatasets bool   `json:"transfer_historical_datasets"`
	ConfirmDatasetPolicy       bool   `json:"confirm_dataset_policy"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, deviceViewAction) {
		return
	}

	projectID, ok := parseOptionalUUIDQuery(c, "project_id")
	if !ok {
		return
	}
	siteID, ok := parseOptionalUUIDQuery(c, "site_id")
	if !ok {
		return
	}

	items, err := h.service.List(c.Request.Context(), ListInput{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		SiteID:      siteID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Create(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	workspaceID, ok := parseUUIDValue(req.WorkspaceID, "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, deviceBindAction) {
		return
	}

	projectID, ok := parseOptionalUUIDValue(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	siteID, ok := parseOptionalUUIDValue(req.SiteID, "site_id", c)
	if !ok {
		return
	}

	result, err := h.service.Create(c.Request.Context(), CreateInput{
		WorkspaceID:  workspaceID,
		ProjectID:    projectID,
		SiteID:       siteID,
		ProductID:    req.ProductID,
		SerialNo:     req.SerialNo,
		Name:         req.Name,
		Capabilities: req.Capabilities,
		ActorUserID:  actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.bind",
			ResourceType: "device",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.bind",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Get(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}

	if !h.authorize(c, "device", deviceID, deviceViewAction) {
		return
	}

	result, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}

	if !h.authorize(c, "device", deviceID, deviceConfigureAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	var req updateDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	projectID, ok := parseOptionalUUIDPointer(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	siteID, ok := parseOptionalUUIDPointer(req.SiteID, "site_id", c)
	if !ok {
		return
	}

	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		DeviceID:     deviceID,
		ProjectID:    projectID,
		SiteID:       siteID,
		ProductID:    req.ProductID,
		SerialNo:     req.SerialNo,
		Name:         req.Name,
		Status:       req.Status,
		Capabilities: req.Capabilities,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.configure",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.configure",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) RequestCalibration(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, deviceCalibrateAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	var req createCalibrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.RequestCalibration(c.Request.Context(), CalibrationInput{
		DeviceID:        deviceID,
		CalibrationType: req.CalibrationType,
		Parameters:      req.Parameters,
		ActorUserID:     actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.calibrate",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.calibrate",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.DeviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) RequestFirmwareUpgrade(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, deviceFirmwareAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	var req createFirmwareUpgradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.RequestFirmwareUpgrade(c.Request.Context(), FirmwareUpgradeInput{
		DeviceID:        deviceID,
		FirmwareVersion: req.FirmwareVersion,
		PackageURI:      req.PackageURI,
		Checksum:        req.Checksum,
		ScheduledAt:     req.ScheduledAt,
		ActorUserID:     actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.firmware_upgrade",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.firmware_upgrade",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.DeviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Transfer(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, deviceTransferAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	current, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	var req transferDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	targetWorkspaceID, ok := parseUUIDValue(req.TargetWorkspaceID, "target_workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", targetWorkspaceID, deviceBindAction) {
		return
	}
	projectID, ok := parseOptionalUUIDValue(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	siteID, ok := parseOptionalUUIDValue(req.SiteID, "site_id", c)
	if !ok {
		return
	}

	result, err := h.service.Transfer(c.Request.Context(), TransferInput{
		DeviceID:                   deviceID,
		TargetWorkspaceID:          targetWorkspaceID,
		ProjectID:                  projectID,
		SiteID:                     siteID,
		TransferHistoricalDatasets: req.TransferHistoricalDatasets,
		ConfirmDatasetPolicy:       req.ConfirmDatasetPolicy,
		ActorUserID:                actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(current.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.transfer",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(current.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.transfer",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) Unbind(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, deviceUnbindAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	result, err := h.service.Unbind(c.Request.Context(), UnbindInput{
		DeviceID:    deviceID,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.unbind",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.unbind",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	actor, ok := actorFromContext(c)
	if !ok {
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return false
	}
	return true
}

func actorFromContext(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return auth.Actor{}, false
	}
	return actor, true
}

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	return parseUUIDValue(c.Param(name), name, c)
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}

func parseOptionalUUIDQuery(c *gin.Context, name string) (*uuid.UUID, bool) {
	return parseOptionalUUIDValue(c.Query(name), name, c)
}

func parseOptionalUUIDValue(value string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == "" {
		return nil, true
	}
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return nil, false
	}
	return &id, true
}

func parseOptionalUUIDPointer(value *string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == nil {
		return nil, true
	}
	return parseOptionalUUIDValue(*value, name, c)
}

func (h *Handler) record(c *gin.Context, input audit.RecordInput) bool {
	if h.audit == nil {
		return true
	}
	if _, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, input)); err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
