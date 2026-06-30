package datastream

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const (
	dataStreamViewAction   = "device.view"
	dataStreamManageAction = "device.configure"
)

type Handler struct {
	service *Service
	checker *permission.Checker
}

type createDataStreamRequest struct {
	DeviceID string `json:"device_id"`
	Code     string `json:"code"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	Unit     string `json:"unit"`
}

type updateDataStreamRequest struct {
	Code   *string `json:"code"`
	Name   *string `json:"name"`
	Type   *string `json:"type"`
	Unit   *string `json:"unit"`
	Status *string `json:"status"`
}

func NewHandler(service *Service, checker *permission.Checker) *Handler {
	return &Handler{service: service, checker: checker}
}

func (h *Handler) List(c *gin.Context) {
	deviceID, ok := parseUUIDValue(c.Query("device_id"), "device_id", c)
	if !ok {
		return
	}

	if !h.authorize(c, "device", deviceID, dataStreamViewAction) {
		return
	}

	items, err := h.service.ListByDevice(c.Request.Context(), deviceID)
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

	var req createDataStreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	deviceID, ok := parseUUIDValue(req.DeviceID, "device_id", c)
	if !ok {
		return
	}

	if !h.authorize(c, "device", deviceID, dataStreamManageAction) {
		return
	}

	result, err := h.service.Create(c.Request.Context(), CreateInput{
		DeviceID:    deviceID,
		Code:        req.Code,
		Name:        req.Name,
		Type:        req.Type,
		Unit:        req.Unit,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Get(c *gin.Context) {
	dataStreamID, ok := parseUUIDParam(c, "data_stream_id")
	if !ok {
		return
	}

	if !h.authorize(c, "data_stream", dataStreamID, dataStreamViewAction) {
		return
	}

	result, err := h.service.Get(c.Request.Context(), dataStreamID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	dataStreamID, ok := parseUUIDParam(c, "data_stream_id")
	if !ok {
		return
	}

	if !h.authorize(c, "data_stream", dataStreamID, dataStreamManageAction) {
		return
	}

	var req updateDataStreamRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		DataStreamID: dataStreamID,
		Code:         req.Code,
		Name:         req.Name,
		Type:         req.Type,
		Unit:         req.Unit,
		Status:       req.Status,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
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
