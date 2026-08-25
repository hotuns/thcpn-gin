package systemadmin

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

func NewHandler(service *Service, auditService *audit.Service) *Handler {
	return &Handler{service: service, audit: auditService}
}

type createRequest struct {
	Name   string `json:"name"`
	Email  string `json:"email"`
	Reason string `json:"reason"`
}
type actionRequest struct {
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	ConfirmText string `json:"confirm_text"`
}

func (h *Handler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}
func (h *Handler) Create(c *gin.Context) {
	var req createRequest
	if !bind(c, &req) || !reason(c, req.Reason) {
		return
	}
	item, password, err := h.service.Create(c.Request.Context(), req.Name, req.Email, "")
	if err != nil {
		h.finish(c, "admin.system_admin.create", uuid.Nil, req.Reason, err)
		return
	}
	if h.finish(c, "admin.system_admin.create", item.ID, req.Reason, nil) {
		c.JSON(http.StatusCreated, gin.H{"administrator": item, "temporary_password": password})
	}
}
func (h *Handler) Status(c *gin.Context) {
	id, ok := id(c)
	if !ok {
		return
	}
	var req actionRequest
	if !bind(c, &req) || !reason(c, req.Reason) || !confirm(c, req.ConfirmText, "确认") {
		return
	}
	actor, _ := auth.ActorFromContext(c)
	err := h.service.SetStatus(c.Request.Context(), id, actor.SystemAdministratorID(), req.Status)
	if h.finish(c, "admin.system_admin.status", id, req.Reason, err) {
		c.Status(http.StatusNoContent)
	}
}
func (h *Handler) Unlock(c *gin.Context) {
	h.action(c, "admin.system_admin.unlock", "", h.service.Unlock)
}
func (h *Handler) RevokeSessions(c *gin.Context) {
	h.action(c, "admin.system_admin.sessions_revoke_all", "", h.service.RevokeSessions)
}
func (h *Handler) ResetPassword(c *gin.Context) {
	id, ok := id(c)
	if !ok {
		return
	}
	var req actionRequest
	if !bind(c, &req) || !reason(c, req.Reason) || !confirm(c, req.ConfirmText, "重置密码") {
		return
	}
	password, err := h.service.ResetPassword(c.Request.Context(), id)
	if h.finish(c, "admin.system_admin.password_reset", id, req.Reason, err) {
		c.JSON(http.StatusOK, gin.H{"temporary_password": password})
	}
}
func (h *Handler) action(c *gin.Context, name, confirmation string, fn func(context.Context, uuid.UUID) error) {
	id, ok := id(c)
	if !ok {
		return
	}
	var req actionRequest
	if !bind(c, &req) || !reason(c, req.Reason) {
		return
	}
	if confirmation != "" && !confirm(c, req.ConfirmText, confirmation) {
		return
	}
	err := fn(c.Request.Context(), id)
	if h.finish(c, name, id, req.Reason, err) {
		c.Status(http.StatusNoContent)
	}
}
func (h *Handler) finish(c *gin.Context, action string, id uuid.UUID, reasonText string, operationErr error) bool {
	result := audit.ResultSuccess
	if operationErr != nil {
		result = audit.ResultFailure
	}
	if h.audit != nil {
		_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{Action: action, ResourceType: "system_admin", ResourceID: audit.ResourceID(id), Result: result, Reason: reasonText}))
		if err != nil {
			httpx.WriteAppError(c, err)
			return false
		}
	}
	if operationErr != nil {
		httpx.WriteAppError(c, operationErr)
		return false
	}
	return true
}
func bind(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return false
	}
	return true
}
func reason(c *gin.Context, value string) bool {
	if len([]rune(strings.TrimSpace(value))) < 5 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "reason must contain at least 5 characters"))
		return false
	}
	return true
}
func confirm(c *gin.Context, value, expected string) bool {
	if strings.TrimSpace(value) != expected {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "confirmation text is required"))
		return false
	}
	return true
}
func id(c *gin.Context) (uuid.UUID, bool) {
	value, err := uuid.Parse(c.Param("admin_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid admin_id"))
		return uuid.Nil, false
	}
	return value, true
}
