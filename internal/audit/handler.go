package audit

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const auditViewAction = "audit.view"

type Handler struct {
	service   *Service
	checker   *permission.Checker
	actorFunc func(*gin.Context) (uuid.UUID, bool)
}

func NewHandler(service *Service, checker *permission.Checker, actorFunc func(*gin.Context) (uuid.UUID, bool)) *Handler {
	return &Handler{service: service, checker: checker, actorFunc: actorFunc}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}

	items, err := h.service.ListByWorkspace(c.Request.Context(), ListInput{
		WorkspaceID: workspaceID,
		Limit:       ParseLimit(c.Query("limit")),
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) authorize(c *gin.Context, workspaceID uuid.UUID) bool {
	userID, ok := h.actorUserID(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: userID}, auditViewAction, permission.ResourceRef{
		Type: "workspace",
		ID:   workspaceID,
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

func (h *Handler) actorUserID(c *gin.Context) (uuid.UUID, bool) {
	if h.actorFunc == nil {
		return uuid.Nil, false
	}
	return h.actorFunc(c)
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
