package demoshowcase

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

func NewHandler(service *Service, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, audit: auditService}
}
func (h *Handler) Get(c *gin.Context) {
	item, err := h.service.Get(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) Configure(c *gin.Context) {
	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	id, err := uuid.Parse(req.UserID)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid user_id"))
		return
	}
	item, err := h.service.Configure(c.Request.Context(), id)
	if err != nil {
		h.record(c, "admin.demo.configure", "user", id, audit.ResultFailure, err)
		return
	}
	if !h.record(c, "admin.demo.configure", "user", id, audit.ResultSuccess, nil) {
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) Devices(c *gin.Context) {
	items, err := h.service.ListDevices(c.Request.Context(), c.Query("q"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Add(c *gin.Context) {
	actor, ok := adminauth.ActorFromContext(c)
	if !ok {
		return
	}
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	if err = h.service.AddDevice(c.Request.Context(), id, actor.UserID); err != nil {
		h.record(c, "admin.demo.device_add", "device", id, audit.ResultFailure, err)
		return
	}
	if !h.record(c, "admin.demo.device_add", "device", id, audit.ResultSuccess, nil) {
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Remove(c *gin.Context) {
	id, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	if err = h.service.RemoveDevice(c.Request.Context(), id); err != nil {
		h.record(c, "admin.demo.device_remove", "device", id, audit.ResultFailure, err)
		return
	}
	if !h.record(c, "admin.demo.device_remove", "device", id, audit.ResultSuccess, nil) {
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) record(c *gin.Context, action, resourceType string, id uuid.UUID, result string, operationErr error) bool {
	if h.audit == nil {
		if operationErr != nil {
			httpx.WriteAppError(c, operationErr)
		}
		return operationErr == nil
	}
	reason := ""
	if operationErr != nil {
		reason = apperr.MessageOf(operationErr)
	}
	_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{Action: action, ResourceType: resourceType, ResourceID: audit.ResourceID(id), Result: result, Reason: reason}))
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	if operationErr != nil {
		httpx.WriteAppError(c, operationErr)
		return false
	}
	return true
}
