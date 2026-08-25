package camera

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const mediaLiveViewAction = "media.live_view"

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type createCameraRequest struct {
	ProductID             string `json:"product_id"`
	Name                  string `json:"name"`
	DeviceSerial          string `json:"device_serial"`
	ChannelNo             int32  `json:"channel_no"`
	DefaultQuality        string `json:"default_quality"`
	IsEncrypted           bool   `json:"is_encrypted"`
	ValidateCodeSecretRef string `json:"validate_code_secret_ref"`
	TargetWorkspaceID     string `json:"target_workspace_id"`
	ProjectID             string `json:"project_id"`
	SiteID                string `json:"site_id"`
}

type updateCameraRequest struct {
	DeviceSerial          *string `json:"device_serial"`
	ChannelNo             *int32  `json:"channel_no"`
	DefaultQuality        *string `json:"default_quality"`
	IsEncrypted           *bool   `json:"is_encrypted"`
	ValidateCodeSecretRef *string `json:"validate_code_secret_ref"`
	Status                *string `json:"status"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) AdminCreate(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	var req createCameraRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	targetWorkspaceID, ok := parseOptionalUUIDValue(req.TargetWorkspaceID, "target_workspace_id", c)
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
	result, err := h.service.Create(c.Request.Context(), CreateInput{
		ProductID:             req.ProductID,
		Name:                  req.Name,
		DeviceSerial:          req.DeviceSerial,
		ChannelNo:             req.ChannelNo,
		DefaultQuality:        req.DefaultQuality,
		IsEncrypted:           req.IsEncrypted,
		ValidateCodeSecretRef: req.ValidateCodeSecretRef,
		Status:                "active",
		TargetWorkspaceID:     targetWorkspaceID,
		ProjectID:             projectID,
		SiteID:                siteID,
		ActorUserID:           actor.UserID,
	})
	if err != nil {
		h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "camera.create",
			ResourceType: "camera",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		})
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "camera.create",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(result.Device.ID),
		Result:       audit.ResultSuccess,
	})
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminGet(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	result, err := h.service.Get(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
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
	var req updateCameraRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		DeviceID:              deviceID,
		DeviceSerial:          req.DeviceSerial,
		ChannelNo:             req.ChannelNo,
		DefaultQuality:        req.DefaultQuality,
		IsEncrypted:           req.IsEncrypted,
		ValidateCodeSecretRef: req.ValidateCodeSecretRef,
		Status:                req.Status,
		ActorUserID:           actor.UserID,
	})
	if err != nil {
		h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "camera.update",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		})
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "camera.update",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(deviceID),
		Result:       audit.ResultSuccess,
	})
	c.JSON(http.StatusOK, result)
}

func (h *Handler) CreateLiveSession(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, actor.UserID, deviceID, mediaLiveViewAction) {
		return
	}
	result, err := h.service.CreateLiveSession(c.Request.Context(), LiveSessionInput{
		DeviceID:    deviceID,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "camera.live_session.create",
			ResourceType: "device",
			ResourceID:   audit.ResourceID(deviceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		})
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, audit.RecordInput{
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "camera.live_session.create",
		ResourceType: "device",
		ResourceID:   audit.ResourceID(deviceID),
		Result:       audit.ResultSuccess,
	})
	c.JSON(http.StatusOK, result)
}

func (h *Handler) authorize(c *gin.Context, actorID uuid.UUID, deviceID uuid.UUID, action string) bool {
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actorID}, action, permission.ResourceRef{
		Type: "device",
		ID:   deviceID,
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

func (h *Handler) record(c *gin.Context, input audit.RecordInput) {
	if h.audit == nil {
		return
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, input))
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

func parseOptionalUUIDValue(value string, name string, c *gin.Context) (*uuid.UUID, bool) {
	if value == "" {
		return nil, true
	}
	id, ok := parseUUIDValue(value, name, c)
	if !ok {
		return nil, false
	}
	return &id, true
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
