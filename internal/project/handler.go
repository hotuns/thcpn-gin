package project

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
	projectViewAction   = "project.view"
	projectManageAction = "project.manage"
)

type Handler struct {
	service *Service
	checker *permission.Checker
}

type createProjectRequest struct {
	WorkspaceID string `json:"workspace_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type updateProjectRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Status      *string `json:"status"`
}

func NewHandler(service *Service, checker *permission.Checker) *Handler {
	return &Handler{service: service, checker: checker}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, projectViewAction) {
		return
	}

	items, err := h.service.List(c.Request.Context(), workspaceID)
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

	var req createProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	workspaceID, ok := parseUUIDValue(req.WorkspaceID, "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, projectManageAction) {
		return
	}

	result, err := h.service.Create(c.Request.Context(), CreateInput{
		WorkspaceID: workspaceID,
		Name:        req.Name,
		Description: req.Description,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Get(c *gin.Context) {
	projectID, ok := parseUUIDParam(c, "project_id")
	if !ok {
		return
	}

	if !h.authorize(c, "project", projectID, projectViewAction) {
		return
	}

	result, err := h.service.Get(c.Request.Context(), projectID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	projectID, ok := parseUUIDParam(c, "project_id")
	if !ok {
		return
	}

	if !h.authorize(c, "project", projectID, projectManageAction) {
		return
	}

	var req updateProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		ProjectID:   projectID,
		Name:        req.Name,
		Description: req.Description,
		Status:      req.Status,
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
