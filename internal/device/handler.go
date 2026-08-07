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
	deviceViewAction       = "device.view"
	deviceBindAction       = "device.bind"
	deviceConfigureAction  = "device.configure"
	deviceCalibrateAction  = "device.calibrate"
	deviceFirmwareAction   = "device.firmware_upgrade"
	deviceTransferAction   = "device.transfer"
	deviceUnbindAction     = "device.unbind"
	serviceAccessUseAction = "service_access.device_access"
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
	DeviceType   *string   `json:"device_type"`
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

type assignDeviceRequest struct {
	TargetWorkspaceID string `json:"target_workspace_id"`
	ProjectID         string `json:"project_id"`
	SiteID            string `json:"site_id"`
}

type addDeviceChildRequest struct {
	ChildDeviceID string `json:"child_device_id"`
}

type updateDeviceLifecycleRequest struct {
	LifecycleStatus string     `json:"lifecycle_status"`
	OccurredAt      *time.Time `json:"occurred_at"`
	Note            string     `json:"note"`
}

type updateDeviceCapabilitiesRequest struct {
	Capabilities []string `json:"capabilities"`
}

type createCapabilityDefinitionRequest struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	SortOrder int32  `json:"sort_order"`
}

type updateCapabilityDefinitionRequest struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	SortOrder int32  `json:"sort_order"`
}

type updateSystemRoleRequest struct {
	Name string `json:"name"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
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
	filtered := make([]Device, 0, len(items))
	for _, item := range items {
		allowed, ok := h.can(c, actor.UserID, "device", item.ID, deviceViewAction)
		if !ok {
			return
		}
		if allowed {
			filtered = append(filtered, item)
		}
	}

	c.JSON(http.StatusOK, gin.H{"items": filtered})
}

func (h *Handler) AdminListSystemAssets(c *gin.Context) {
	items, err := h.service.ListSystemAssets(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminUpdate(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req updateDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if req.ProjectID != nil || req.SiteID != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "assignment is managed by separate admin actions"))
		return
	}
	result, err := h.service.AdminUpdate(c.Request.Context(), AdminUpdateInput{
		DeviceID:     deviceID,
		ProductID:    req.ProductID,
		SerialNo:     req.SerialNo,
		Name:         req.Name,
		Status:       req.Status,
		DeviceType:   req.DeviceType,
		Capabilities: req.Capabilities,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.admin_update",
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
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.admin_update",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminLifecycle(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	result, err := h.service.ListLifecycle(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminUpdateLifecycle(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req updateDeviceLifecycleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateLifecycle(c.Request.Context(), UpdateLifecycleInput{
		DeviceID:        deviceID,
		LifecycleStatus: req.LifecycleStatus,
		OccurredAt:      req.OccurredAt,
		Note:            req.Note,
		ActorUserID:     actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.lifecycle.update",
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
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.lifecycle.update",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(deviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminCapabilities(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	capabilities, err := h.service.ListCapabilities(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"capabilities": capabilities})
}

func (h *Handler) AdminUpdateCapabilities(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req updateDeviceCapabilitiesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	capabilities, err := h.service.UpdateCapabilities(c.Request.Context(), UpdateCapabilitiesInput{
		DeviceID:     deviceID,
		Capabilities: req.Capabilities,
		ActorUserID:  actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device.capability.update",
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
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.capability.update",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(deviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"capabilities": capabilities})
}

func (h *Handler) AdminListCapabilityDefinitions(c *gin.Context) {
	items, err := h.service.ListCapabilityDefinitions(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminCreateCapabilityDefinition(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	var req createCapabilityDefinitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.CreateCapabilityDefinition(c.Request.Context(), CreateCapabilityDefinitionInput{
		Code:      req.Code,
		Name:      req.Name,
		Status:    req.Status,
		SortOrder: req.SortOrder,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "metadata.device_capability.create",
			ResourceType: "device_capability",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "metadata.device_capability.create",
		ResourceType: "device_capability",
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AdminUpdateCapabilityDefinition(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	code := c.Param("code")
	var req updateCapabilityDefinitionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateCapabilityDefinition(c.Request.Context(), UpdateCapabilityDefinitionInput{
		Code:      code,
		Name:      req.Name,
		Status:    req.Status,
		SortOrder: req.SortOrder,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "metadata.device_capability.update",
			ResourceType: "device_capability",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "metadata.device_capability.update",
		ResourceType: "device_capability",
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminListSystemRoles(c *gin.Context) {
	items, err := h.service.ListSystemRoles(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminUpdateSystemRole(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	code := c.Param("code")
	var req updateSystemRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.UpdateSystemRole(c.Request.Context(), UpdateSystemRoleInput{
		Code: code,
		Name: req.Name,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "metadata.system_role.update",
			ResourceType: "system_role",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "metadata.system_role.update",
		ResourceType: "system_role",
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminChildren(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	items, err := h.service.ListAdminChildren(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminAddChild(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	parentDeviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req addDeviceChildRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	childDeviceID, ok := parseUUIDValue(req.ChildDeviceID, "child_device_id", c)
	if !ok {
		return
	}
	relation, err := h.service.AddChild(c.Request.Context(), AddChildInput{
		ParentDeviceID: parentDeviceID,
		ChildDeviceID:  childDeviceID,
		ActorUserID:    actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device_relation.admin_set",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(parentDeviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device_relation.admin_set",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(parentDeviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, relation)
}

func (h *Handler) AdminRemoveChild(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	parentDeviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	childDeviceID, ok := parseUUIDParam(c, "child_device_id")
	if !ok {
		return
	}
	relation, err := h.service.RemoveChild(c.Request.Context(), RemoveChildInput{
		ParentDeviceID: parentDeviceID,
		ChildDeviceID:  childDeviceID,
		ActorUserID:    actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "device_relation.admin_remove",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(parentDeviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device_relation.admin_remove",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(relation.ParentDeviceID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}
	c.JSON(http.StatusOK, relation)
}

func (h *Handler) AdminAssign(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}

	var req assignDeviceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	targetWorkspaceID, ok := parseUUIDValue(req.TargetWorkspaceID, "target_workspace_id", c)
	if !ok {
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

	result, err := h.service.Assign(c.Request.Context(), AssignInput{
		DeviceID:          deviceID,
		TargetWorkspaceID: targetWorkspaceID,
		ProjectID:         projectID,
		SiteID:            siteID,
		ActorUserID:       actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminUnassign(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if err := h.service.Unbind(c.Request.Context(), UnbindInput{
		DeviceID:    deviceID,
		ActorUserID: actor.UserID,
	}); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) AdminRequestCalibration(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req createCalibrationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.RequestCalibration(c.Request.Context(), CalibrationInput{
		DeviceID: deviceID, CalibrationType: req.CalibrationType, Parameters: req.Parameters, ActorUserID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "device.calibrate", ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AdminRequestFirmwareUpgrade(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	var req createFirmwareUpgradeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.RequestFirmwareUpgrade(c.Request.Context(), FirmwareUpgradeInput{
		DeviceID: deviceID, FirmwareVersion: req.FirmwareVersion, PackageURI: req.PackageURI, Checksum: req.Checksum, ScheduledAt: req.ScheduledAt, ActorUserID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "device.firmware_upgrade", ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusCreated, result)
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
		WorkspaceID:  audit.WorkspaceID(workspaceIDValue(result.WorkspaceID)),
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

	decision, ok := h.authorizeDecision(c, "device", deviceID, deviceViewAction)
	if !ok {
		return
	}

	result, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if isServiceEngineerAccess(decision) {
		actor, _ := auth.ActorFromContext(c)
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceIDValue(result.WorkspaceID)),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       serviceAccessUseAction,
			ResourceType: "device",
			ResourceID:   audit.ResourceID(result.ID),
			Result:       audit.ResultSuccess,
		}) {
			return
		}
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Children(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, deviceViewAction) {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	items, err := h.service.ListVisibleChildren(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	visible := make([]DeviceChild, 0, len(items))
	for _, item := range items {
		decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, deviceViewAction, permission.ResourceRef{
			Type: "device",
			ID:   item.Device.ID,
		})
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		if decision.Allowed {
			visible = append(visible, item)
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": visible})
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
		WorkspaceID:  audit.WorkspaceID(workspaceIDValue(result.WorkspaceID)),
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
			WorkspaceID:  audit.WorkspaceID(workspaceIDValue(current.WorkspaceID)),
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
		WorkspaceID:  audit.WorkspaceID(workspaceIDValue(current.WorkspaceID)),
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

	current, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	err = h.service.Unbind(c.Request.Context(), UnbindInput{
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
		WorkspaceID:  audit.WorkspaceID(workspaceIDValue(current.WorkspaceID)),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "device.unbind",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(current.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	_, ok := h.authorizeDecision(c, resourceType, resourceID, action)
	return ok
}

func (h *Handler) can(c *gin.Context, userID uuid.UUID, resourceType string, resourceID uuid.UUID, action string) (bool, bool) {
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: userID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return false, false
	}
	return decision.Allowed, true
}

func (h *Handler) authorizeDecision(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) (permission.Decision, bool) {
	actor, ok := actorFromContext(c)
	if !ok {
		return permission.Decision{}, false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return permission.Decision{}, false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return permission.Decision{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return permission.Decision{}, false
	}
	return decision, true
}

func isServiceEngineerAccess(decision permission.Decision) bool {
	return decision.Source == "access_grant" && decision.GrantRoleCode == "service_engineer"
}

func workspaceIDValue(value *uuid.UUID) uuid.UUID {
	if value == nil {
		return uuid.Nil
	}
	return *value
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
