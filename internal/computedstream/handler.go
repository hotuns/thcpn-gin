package computedstream

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

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type metadataRequest struct {
	Items []MetadataInput `json:"items"`
}

type createRequest struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Unit    string `json:"unit"`
	Formula string `json:"formula"`
	Enabled *bool  `json:"enabled"`
}

type updateRequest struct {
	Code    *string `json:"code"`
	Name    *string `json:"name"`
	Unit    *string `json:"unit"`
	Formula *string `json:"formula"`
	Enabled *bool   `json:"enabled"`
}

type previewRequest struct {
	Formula  string             `json:"formula"`
	Streams  map[string]float64 `json:"streams"`
	Metadata map[string]float64 `json:"metadata"`
}

func NewHandler(service *Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) ListMetadata(c *gin.Context) {
	deviceID, _, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	items, err := h.service.ListMetadata(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ReplaceMetadata(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req metadataRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	items, err := h.service.ReplaceMetadata(c.Request.Context(), deviceID, actor.UserID, req.Items)
	if err != nil {
		h.record(c, actor.UserID, deviceID, "device.metadata.update", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.metadata.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) List(c *gin.Context) {
	deviceID, _, ok := h.authorize(c, "device.view")
	if !ok {
		return
	}
	items, err := h.service.ListDefinitions(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Create(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	item, err := h.service.Create(c.Request.Context(), CreateInput{
		DeviceID: deviceID, ActorID: actor.UserID, Code: req.Code, Name: req.Name,
		Unit: req.Unit, Formula: req.Formula, Enabled: enabled,
	})
	if err != nil {
		h.record(c, actor.UserID, deviceID, "device.computed_stream.create", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.computed_stream.create", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusCreated, item)
}

func (h *Handler) Update(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	streamID, ok := parseUUID(c.Param("data_stream_id"), "data_stream_id", c)
	if !ok {
		return
	}
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Update(c.Request.Context(), UpdateInput{
		DeviceID: deviceID, DataStreamID: streamID, ActorID: actor.UserID,
		Code: req.Code, Name: req.Name, Unit: req.Unit, Formula: req.Formula, Enabled: req.Enabled,
	})
	if err != nil {
		h.record(c, actor.UserID, deviceID, "device.computed_stream.update", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.computed_stream.update", audit.ResultSuccess, "") {
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) Delete(c *gin.Context) {
	deviceID, actor, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	streamID, ok := parseUUID(c.Param("data_stream_id"), "data_stream_id", c)
	if !ok {
		return
	}
	if err := h.service.Delete(c.Request.Context(), deviceID, streamID); err != nil {
		h.record(c, actor.UserID, deviceID, "device.computed_stream.delete", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, actor.UserID, deviceID, "device.computed_stream.delete", audit.ResultSuccess, "") {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) Preview(c *gin.Context) {
	deviceID, _, ok := h.authorize(c, "device.configure")
	if !ok {
		return
	}
	var req previewRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Preview(c.Request.Context(), PreviewInput{
		DeviceID: deviceID, Formula: req.Formula, Streams: req.Streams, Metadata: req.Metadata,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) authorize(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	deviceID, ok := parseUUID(c.Param("device_id"), "device_id", c)
	if !ok {
		return uuid.Nil, auth.Actor{}, false
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "device", ID: deviceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return deviceID, actor, true
}

func (h *Handler) record(c *gin.Context, actorID, deviceID uuid.UUID, action, result, reason string) bool {
	if h.audit == nil {
		return true
	}
	_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{
		ActorType: audit.ActorUser, ActorID: audit.UserActorID(actorID), Action: action,
		ResourceType: "device", ResourceID: audit.ResourceID(deviceID), Result: result, Reason: reason,
	}))
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}

func parseUUID(value, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
