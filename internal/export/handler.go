package export

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
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

const auditViewAction = "audit.view"

type Handler struct {
	service  *Service
	checker  *permission.Checker
	audit    *audit.Service
	enqueuer JobEnqueuer
}

type JobEnqueuer interface {
	EnqueueExportJob(ctx context.Context, jobID uuid.UUID) error
}

type createExportJobRequest struct {
	ResourceType  string          `json:"resource_type"`
	ResourceID    string          `json:"resource_id"`
	ExportType    string          `json:"export_type"`
	StartTime     *time.Time      `json:"start_time"`
	EndTime       *time.Time      `json:"end_time"`
	Limit         *int            `json:"limit"`
	RequestConfig json.RawMessage `json:"request_config"`
	ExpiresAt     *time.Time      `json:"expires_at"`
}

type datasetExportRequest struct {
	ExportType    string          `json:"export_type"`
	RequestConfig json.RawMessage `json:"request_config"`
	ExpiresAt     *time.Time      `json:"expires_at"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) SetJobEnqueuer(enqueuer JobEnqueuer) {
	h.enqueuer = enqueuer
}

func (h *Handler) List(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	workspaceID, workspaceProvided, ok := parseOptionalUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	mine, ok := parseMine(c.Query("mine"), !workspaceProvided, c)
	if !ok {
		return
	}

	input := ListInput{
		WorkspaceID: workspaceID,
		Limit:       audit.ParseLimit(c.Query("limit")),
	}
	if mine {
		input.RequestedBy = &actor.UserID
	} else {
		if !workspaceProvided {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "workspace_id is required when mine is false"))
			return
		}
		if !h.authorize(c, actor, "workspace", workspaceID, auditViewAction) {
			return
		}
	}

	items, err := h.service.List(c.Request.Context(), input)
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

	var req createExportJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	resourceID, ok := parseUUIDValue(req.ResourceID, "resource_id", c)
	if !ok {
		return
	}

	requestConfig, ok := buildRequestConfig(req.ExportType, req.RequestConfig, req.StartTime, req.EndTime, req.Limit, c)
	if !ok {
		return
	}

	job, ok := h.createJob(c, actor, req.ResourceType, resourceID, req.ExportType, requestConfig, req.ExpiresAt)
	if !ok {
		return
	}
	c.JSON(http.StatusCreated, job)
}

func (h *Handler) ExportDataset(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	datasetID, ok := parseUUIDParam(c, "dataset_id")
	if !ok {
		return
	}

	req := datasetExportRequest{ExportType: "dataset_zip"}
	if c.Request.Body != nil && c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
			return
		}
	}
	if strings.TrimSpace(req.ExportType) == "" {
		req.ExportType = "dataset_zip"
	}

	job, ok := h.createJob(c, actor, "dataset", datasetID, req.ExportType, req.RequestConfig, req.ExpiresAt)
	if !ok {
		return
	}
	c.JSON(http.StatusCreated, job)
}

func (h *Handler) Get(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	jobID, ok := parseUUIDParam(c, "export_job_id")
	if !ok {
		return
	}

	job, err := h.service.Get(c.Request.Context(), jobID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	resolved, err := h.service.Resolve(c.Request.Context(), job.ResourceType, job.ResourceID, job.ExportType)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	allowed, ok := h.canAccessJob(c, actor, job, resolved)
	if !ok {
		return
	}
	if !allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *Handler) Download(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	jobID, ok := parseUUIDParam(c, "export_job_id")
	if !ok {
		return
	}

	job, err := h.service.Get(c.Request.Context(), jobID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	resolved, err := h.service.Resolve(c.Request.Context(), job.ResourceType, job.ResourceID, job.ExportType)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	allowed, ok := h.canAccessJob(c, actor, job, resolved)
	if !ok {
		return
	}
	if !allowed {
		if !h.record(c, auditInput(actor, resolved, audit.ResultFailure, "permission denied")) {
			return
		}
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return
	}

	result, err := h.service.PrepareDownload(c.Request.Context(), jobID)
	if err != nil {
		if !h.record(c, auditInput(actor, resolved, audit.ResultFailure, apperr.MessageOf(err))) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, auditInput(actor, resolved, audit.ResultSuccess, "")) {
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) createJob(c *gin.Context, actor auth.Actor, resourceType string, resourceID uuid.UUID, exportType string, requestConfig json.RawMessage, expiresAt *time.Time) (Job, bool) {
	resolved, err := h.service.Resolve(c.Request.Context(), resourceType, resourceID, exportType)
	if err != nil {
		httpx.WriteAppError(c, err)
		return Job{}, false
	}

	allowed, err := h.check(c, actor, resolved.PermissionResourceType, resolved.PermissionResourceID, resolved.Action)
	if err != nil {
		httpx.WriteAppError(c, err)
		return Job{}, false
	}
	if !allowed {
		if !h.record(c, auditInput(actor, resolved, audit.ResultFailure, "permission denied")) {
			return Job{}, false
		}
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return Job{}, false
	}

	job, _, err := h.service.Create(c.Request.Context(), CreateInput{
		ResourceType:  resourceType,
		ResourceID:    resourceID,
		ExportType:    exportType,
		RequestConfig: requestConfig,
		RequestedBy:   actor.UserID,
		ExpiresAt:     expiresAt,
	})
	if err != nil {
		if !h.record(c, auditInput(actor, resolved, audit.ResultFailure, apperr.MessageOf(err))) {
			return Job{}, false
		}
		httpx.WriteAppError(c, err)
		return Job{}, false
	}
	if h.enqueuer != nil {
		if err := h.enqueuer.EnqueueExportJob(c.Request.Context(), job.ID); err != nil {
			if !h.record(c, auditInput(actor, resolved, audit.ResultFailure, apperr.MessageOf(err))) {
				return Job{}, false
			}
			httpx.WriteAppError(c, err)
			return Job{}, false
		}
	}
	if !h.record(c, auditInput(actor, resolved, audit.ResultSuccess, "")) {
		return Job{}, false
	}
	return job, true
}

func buildRequestConfig(exportType string, raw json.RawMessage, start *time.Time, end *time.Time, limit *int, c *gin.Context) (json.RawMessage, bool) {
	config := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &config); err != nil || config == nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "request_config must be a JSON object"))
			return nil, false
		}
	}
	if start != nil {
		config["start_time"] = start.UTC().Format(time.RFC3339)
	}
	if end != nil {
		config["end_time"] = end.UTC().Format(time.RFC3339)
	}
	if limit != nil {
		config["limit"] = *limit
	}

	switch strings.TrimSpace(exportType) {
	case "telemetry_csv", "telemetry_excel", "media_zip":
		if strings.TrimSpace(stringValue(config["start_time"])) == "" || strings.TrimSpace(stringValue(config["end_time"])) == "" {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "start_time and end_time are required for this export_type"))
			return nil, false
		}
	}

	encoded, err := json.Marshal(config)
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "marshal request_config", err))
		return nil, false
	}
	return encoded, true
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}

func (h *Handler) canAccessJob(c *gin.Context, actor auth.Actor, job Job, resolved ResolvedResource) (bool, bool) {
	if job.RequestedBy == actor.UserID {
		return true, true
	}
	allowed, err := h.check(c, actor, resolved.PermissionResourceType, resolved.PermissionResourceID, resolved.Action)
	if err != nil {
		httpx.WriteAppError(c, err)
		return false, false
	}
	return allowed, true
}

func (h *Handler) authorize(c *gin.Context, actor auth.Actor, resourceType string, resourceID uuid.UUID, action string) bool {
	allowed, err := h.check(c, actor, resourceType, resourceID, action)
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	if !allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return false
	}
	return true
}

func (h *Handler) check(c *gin.Context, actor auth.Actor, resourceType string, resourceID uuid.UUID, action string) (bool, error) {
	if h.checker == nil {
		return false, apperr.New(apperr.KindInternal, "permission checker is not configured")
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		return false, err
	}
	return decision.Allowed, nil
}

func auditInput(actor auth.Actor, resolved ResolvedResource, result string, reason string) audit.RecordInput {
	return audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(resolved.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       resolved.Action,
		ResourceType: resolved.PermissionResourceType,
		ResourceID:   audit.ResourceID(resolved.PermissionResourceID),
		Result:       result,
		Reason:       reason,
	}
}

func actorFromContext(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return auth.Actor{}, false
	}
	return actor, true
}

func parseMine(value string, defaultValue bool, c *gin.Context) (bool, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultValue, true
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid mine"))
		return false, false
	}
	return parsed, true
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

func parseOptionalUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool, bool) {
	if strings.TrimSpace(value) == "" {
		return uuid.Nil, false, true
	}
	id, ok := parseUUIDValue(value, name, c)
	if !ok {
		return uuid.Nil, true, false
	}
	return id, true, true
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
