package site

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

const (
	siteViewAction   = "site.view"
	siteManageAction = "site.manage"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type createSiteRequest struct {
	WorkspaceID  string   `json:"workspace_id"`
	ProjectID    string   `json:"project_id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	LocationText string   `json:"location_text"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
}

type updateSiteRequest struct {
	Name         *string  `json:"name"`
	Description  *string  `json:"description"`
	LocationText *string  `json:"location_text"`
	Latitude     *float64 `json:"latitude"`
	Longitude    *float64 `json:"longitude"`
	Status       *string  `json:"status"`
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

	projectID := uuid.Nil
	if c.Query("project_id") != "" {
		parsed, ok := parseUUIDValue(c.Query("project_id"), "project_id", c)
		if !ok {
			return
		}
		projectID = parsed
	}

	items, err := h.service.List(c.Request.Context(), ListInput{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	filtered := make([]Site, 0, len(items))
	for _, item := range items {
		allowed, ok := h.can(c, actor.UserID, "site", item.ID, siteViewAction)
		if !ok {
			return
		}
		if allowed {
			filtered = append(filtered, item)
		}
	}

	c.JSON(http.StatusOK, gin.H{"items": filtered})
}

func (h *Handler) AdminList(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}

	projectID := uuid.Nil
	if c.Query("project_id") != "" {
		parsed, ok := parseUUIDValue(c.Query("project_id"), "project_id", c)
		if !ok {
			return
		}
		projectID = parsed
	}

	items, err := h.service.List(c.Request.Context(), ListInput{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
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

	var req createSiteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	workspaceID, ok := parseUUIDValue(req.WorkspaceID, "workspace_id", c)
	if !ok {
		return
	}
	projectID, ok := parseUUIDValue(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "project", projectID, siteManageAction) {
		return
	}

	result, err := h.service.Create(c.Request.Context(), CreateInput{
		WorkspaceID:  workspaceID,
		ProjectID:    projectID,
		Name:         req.Name,
		Description:  req.Description,
		LocationText: req.LocationText,
		Latitude:     req.Latitude,
		Longitude:    req.Longitude,
		ActorUserID:  actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "site.create",
			ResourceType: "site",
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
		Action:       "site.create",
		ResourceType: "site",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Get(c *gin.Context) {
	siteID, ok := parseUUIDParam(c, "site_id")
	if !ok {
		return
	}

	if !h.authorize(c, "site", siteID, siteViewAction) {
		return
	}

	result, err := h.service.Get(c.Request.Context(), siteID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	siteID, ok := parseUUIDParam(c, "site_id")
	if !ok {
		return
	}

	if !h.authorize(c, "site", siteID, siteManageAction) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	var req updateSiteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		SiteID:       siteID,
		Name:         req.Name,
		Description:  req.Description,
		LocationText: req.LocationText,
		Latitude:     req.Latitude,
		Longitude:    req.Longitude,
		Status:       req.Status,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "site.update",
			ResourceType: "site",
			ResourceID:   audit.ResourceID(siteID),
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
		Action:       "site.update",
		ResourceType: "site",
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
