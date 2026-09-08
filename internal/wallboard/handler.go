package wallboard

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/adminauth"
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

func NewHandler(service *Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) Templates(c *gin.Context) {
	items, err := h.service.Templates(c.Request.Context(), false)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Preview(c *gin.Context) {
	item, err := h.service.Template(c.Request.Context(), c.Param("code"), true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	sample, err := PreviewSnapshot(item)
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "read template preview", err))
		return
	}
	c.JSON(http.StatusOK, gin.H{"template": item, "snapshot": sample})
}
func (h *Handler) List(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "wallboard.view")
	if !ok {
		return
	}
	items, err := h.service.List(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Get(c *gin.Context) {
	workspaceID, _, id, ok := h.authorizeItem(c, "wallboard.view")
	if !ok {
		return
	}
	item, err := h.service.Get(c.Request.Context(), workspaceID, id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

type saveRequest struct {
	Name         string          `json:"name"`
	TemplateCode string          `json:"template_code"`
	Config       json.RawMessage `json:"config"`
}

func (h *Handler) Create(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "wallboard.manage")
	if !ok {
		return
	}
	var req saveRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Save(c.Request.Context(), workspaceID, actor.UserID, uuid.Nil, req.Name, req.TemplateCode, req.Config)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}
func (h *Handler) Update(c *gin.Context) {
	workspaceID, actor, id, ok := h.authorizeItem(c, "wallboard.manage")
	if !ok {
		return
	}
	current, err := h.service.Get(c.Request.Context(), workspaceID, id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	var req saveRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Save(c.Request.Context(), workspaceID, actor.UserID, id, req.Name, current.TemplateCode, req.Config)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) Delete(c *gin.Context) {
	workspaceID, _, id, ok := h.authorizeItem(c, "wallboard.manage")
	if !ok {
		return
	}
	if err := h.service.Archive(c.Request.Context(), workspaceID, id); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Snapshot(c *gin.Context) {
	workspaceID, _, id, ok := h.authorizeItem(c, "wallboard.view")
	if !ok {
		return
	}
	item, err := h.service.Snapshot(c.Request.Context(), workspaceID, id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) AdminTemplates(c *gin.Context) {
	items, err := h.service.Templates(c.Request.Context(), true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) AdminSync(c *gin.Context) {
	actor, ok := adminauth.ActorFromContext(c)
	if !ok {
		return
	}
	err := h.service.Sync(c.Request.Context())
	h.record(c, "admin.wallboard_template.sync", "", actor.UserID, err)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.AdminTemplates(c)
}
func (h *Handler) AdminUpdate(c *gin.Context) {
	actor, ok := adminauth.ActorFromContext(c)
	if !ok {
		return
	}
	var req struct {
		Status       string `json:"status"`
		Tier         string `json:"tier"`
		DisplayPrice string `json:"display_price"`
		ContactCopy  string `json:"contact_copy"`
	}
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.UpdateTemplate(c.Request.Context(), c.Param("code"), req.Status, req.Tier, req.DisplayPrice, req.ContactCopy)
	h.record(c, "admin.wallboard_template.update", c.Param("code"), actor.UserID, err)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) authorize(c *gin.Context, action string) (uuid.UUID, auth.Actor, bool) {
	workspaceID, err := uuid.Parse(c.Param("workspace_id"))
	if err != nil || workspaceID == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return uuid.Nil, auth.Actor{}, false
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "workspace", ID: workspaceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, auth.Actor{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, auth.Actor{}, false
	}
	return workspaceID, actor, true
}
func (h *Handler) authorizeItem(c *gin.Context, action string) (uuid.UUID, auth.Actor, uuid.UUID, bool) {
	workspaceID, actor, ok := h.authorize(c, action)
	if !ok {
		return uuid.Nil, auth.Actor{}, uuid.Nil, false
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil || id == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid wallboard id"))
		return uuid.Nil, auth.Actor{}, uuid.Nil, false
	}
	return workspaceID, actor, id, true
}
func (h *Handler) record(c *gin.Context, action, resourceID string, actorID uuid.UUID, cause error) {
	if h.audit == nil {
		return
	}
	result := audit.ResultSuccess
	reason := ""
	if cause != nil {
		result = audit.ResultFailure
		reason = apperr.MessageOf(cause)
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{Action: action, ResourceType: "wallboard_template", Result: result, Reason: reason}))
}
