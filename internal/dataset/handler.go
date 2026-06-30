package dataset

import (
	"net/http"
	"strings"
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
	datasetCreateAction = "dataset.create"
	datasetDeleteAction = "dataset.delete"
	datasetLockAction   = "dataset.lock"
	datasetViewAction   = "dataset.view"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type sourceRequest struct {
	SourceType string `json:"source_type"`
	SourceID   string `json:"source_id"`
}

type createDatasetRequest struct {
	WorkspaceID string          `json:"workspace_id"`
	ProjectID   string          `json:"project_id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	DataType    string          `json:"data_type"`
	TimeStart   time.Time       `json:"time_start"`
	TimeEnd     time.Time       `json:"time_end"`
	Sources     []sourceRequest `json:"sources"`
}

type updateDatasetRequest struct {
	Name        *string          `json:"name"`
	Description *string          `json:"description"`
	DataType    *string          `json:"data_type"`
	TimeStart   *time.Time       `json:"time_start"`
	TimeEnd     *time.Time       `json:"time_end"`
	Status      *string          `json:"status"`
	Sources     *[]sourceRequest `json:"sources"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, datasetViewAction) {
		return
	}

	projectID, ok := parseOptionalUUIDValue(c.Query("project_id"), "project_id", c)
	if !ok {
		return
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

	var req createDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	workspaceID, ok := parseUUIDValue(req.WorkspaceID, "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, "workspace", workspaceID, datasetCreateAction) {
		return
	}

	projectID, ok := parseOptionalUUIDValue(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	sources, ok := parseSources(req.Sources, c)
	if !ok {
		return
	}

	result, err := h.service.Create(c.Request.Context(), CreateInput{
		WorkspaceID: workspaceID,
		ProjectID:   projectID,
		Name:        req.Name,
		Description: req.Description,
		DataType:    req.DataType,
		TimeStart:   req.TimeStart,
		TimeEnd:     req.TimeEnd,
		Sources:     sources,
		ActorUserID: actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       datasetCreateAction,
			ResourceType: "dataset",
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
		Action:       datasetCreateAction,
		ResourceType: "dataset",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) Get(c *gin.Context) {
	datasetID, ok := parseUUIDParam(c, "dataset_id")
	if !ok {
		return
	}
	if !h.authorize(c, "dataset", datasetID, datasetViewAction) {
		return
	}

	result, err := h.service.Get(c.Request.Context(), datasetID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Update(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	datasetID, ok := parseUUIDParam(c, "dataset_id")
	if !ok {
		return
	}

	var req updateDatasetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	action := updateAction(req.Status)
	if !h.authorize(c, "dataset", datasetID, action) {
		return
	}

	var sources *[]SourceInput
	if req.Sources != nil {
		parsed, ok := parseSources(*req.Sources, c)
		if !ok {
			return
		}
		sources = &parsed
	}

	result, err := h.service.Update(c.Request.Context(), UpdateInput{
		DatasetID:   datasetID,
		Name:        req.Name,
		Description: req.Description,
		DataType:    req.DataType,
		TimeStart:   req.TimeStart,
		TimeEnd:     req.TimeEnd,
		Status:      req.Status,
		Sources:     sources,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       action,
			ResourceType: "dataset",
			ResourceID:   audit.ResourceID(datasetID),
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
		Action:       action,
		ResourceType: "dataset",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) Delete(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	datasetID, ok := parseUUIDParam(c, "dataset_id")
	if !ok {
		return
	}
	if !h.authorize(c, "dataset", datasetID, datasetDeleteAction) {
		return
	}

	deleted, err := h.service.Delete(c.Request.Context(), datasetID)
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       datasetDeleteAction,
			ResourceType: "dataset",
			ResourceID:   audit.ResourceID(datasetID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(deleted.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       datasetDeleteAction,
		ResourceType: "dataset",
		ResourceID:   audit.ResourceID(deleted.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.Status(http.StatusNoContent)
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

func updateAction(status *string) string {
	if status != nil && strings.TrimSpace(*status) == "locked" {
		return datasetLockAction
	}
	return datasetCreateAction
}

func actorFromContext(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return auth.Actor{}, false
	}
	return actor, true
}

func parseSources(values []sourceRequest, c *gin.Context) ([]SourceInput, bool) {
	sources := make([]SourceInput, 0, len(values))
	for _, value := range values {
		sourceID, ok := parseUUIDValue(value.SourceID, "source_id", c)
		if !ok {
			return nil, false
		}
		sources = append(sources, SourceInput{
			SourceType: value.SourceType,
			SourceID:   sourceID,
		})
	}
	return sources, true
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
