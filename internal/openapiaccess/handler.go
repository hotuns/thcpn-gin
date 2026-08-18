package openapiaccess

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/datasource"
	exportservice "thcpn-gin/internal/export"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/media"
	"thcpn-gin/internal/permission"
	"thcpn-gin/internal/telemetry"
)

type Handler struct {
	service     *Service
	telemetry   *telemetry.Service
	exports     *exportservice.Service
	dataSources *datasource.Service
	media       *media.Service
	checker     *permission.Checker
	audit       *audit.Service
}

func NewHandler(service *Service, telemetryService *telemetry.Service, exportService *exportservice.Service, dataSourceService *datasource.Service, mediaService *media.Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, telemetry: telemetryService, exports: exportService, dataSources: dataSourceService, media: mediaService, checker: checker, audit: auditService}
}

type createRequest struct {
	Name      string     `json:"name"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func parseID(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil || id == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) authorizeManage(c *gin.Context) (uuid.UUID, auth.Actor, bool) {
	workspaceID, ok := parseID(c, "workspace_id")
	if !ok {
		return uuid.Nil, auth.Actor{}, false
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "workspace.manage", permission.ResourceRef{Type: "workspace", ID: workspaceID})
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
func (h *Handler) List(c *gin.Context) {
	workspaceID, _, ok := h.authorizeManage(c)
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
func (h *Handler) Create(c *gin.Context) {
	workspaceID, actor, ok := h.authorizeManage(c)
	if !ok {
		return
	}
	var req createRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Create(c.Request.Context(), workspaceID, actor.UserID, req.Name, req.ExpiresAt)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, workspaceID, actor.UserID, "api_key.create", item.ID)
	c.JSON(http.StatusCreated, item)
}
func (h *Handler) Revoke(c *gin.Context) {
	workspaceID, actor, ok := h.authorizeManage(c)
	if !ok {
		return
	}
	keyID, ok := parseID(c, "key_id")
	if !ok {
		return
	}
	if err := h.service.Revoke(c.Request.Context(), workspaceID, keyID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, workspaceID, actor.UserID, "api_key.revoke", keyID)
	c.Status(http.StatusNoContent)
}
func (h *Handler) record(c *gin.Context, workspaceID, userID uuid.UUID, action string, resourceID uuid.UUID) {
	if h.audit == nil {
		return
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(workspaceID), ActorType: audit.ActorUser, ActorID: audit.UserActorID(userID), Action: action, ResourceType: "api_key", ResourceID: audit.ResourceID(resourceID), Result: audit.ResultSuccess}))
}

func (h *Handler) QueryTelemetry(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return
	}
	if err := h.service.DeviceBelongsToWorkspace(c.Request.Context(), deviceID, key.WorkspaceID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	start, err := time.Parse(time.RFC3339, c.Query("start_time"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid start_time"))
		return
	}
	end, err := time.Parse(time.RFC3339, c.Query("end_time"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid end_time"))
		return
	}
	limit := 0
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		limit, err = strconv.Atoi(rawLimit)
		if err != nil || limit <= 0 {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid limit"))
			return
		}
	}
	streamIDs := []uuid.UUID{}
	if rawIDs := strings.TrimSpace(c.Query("data_stream_ids")); rawIDs != "" {
		for _, rawID := range strings.Split(rawIDs, ",") {
			id, parseErr := uuid.Parse(strings.TrimSpace(rawID))
			if parseErr != nil {
				httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid data_stream_ids"))
				return
			}
			streamIDs = append(streamIDs, id)
		}
	}
	result, err := h.telemetry.Query(c.Request.Context(), telemetry.QueryInput{DeviceID: &deviceID, DataStreamIDs: streamIDs, StartTime: start, EndTime: end, Limit: limit, Adaptive: true})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) ListDevices(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	items, err := h.service.ListDevices(c, key.WorkspaceID, c.Query("device_type"), c.Query("status"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

func (h *Handler) GetDevice(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return
	}
	item, err := h.service.GetDevice(c, key.WorkspaceID, deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) ListDataStreams(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return
	}
	items, err := h.service.ListDataStreams(c, key.WorkspaceID, deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": len(items)})
}

func (h *Handler) ListMedia(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return
	}
	if err := h.service.DeviceBelongsToWorkspace(c, deviceID, key.WorkspaceID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	start, ok := parseRequiredTime(c, "start_time")
	if !ok {
		return
	}
	end, ok := parseRequiredTime(c, "end_time")
	if !ok {
		return
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	result, err := h.media.List(c, media.QueryInput{DeviceID: &deviceID, MediaType: c.Query("media_type"), StartTime: start, EndTime: end, Page: page, PageSize: pageSize, DownloadAllowed: true})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	for i := range result.Items {
		if result.Items[i].DownloadURL != nil {
			parsed, _ := url.Parse(*result.Items[i].DownloadURL)
			next := "/api/v1/open/media/download?token=" + url.QueryEscape(parsed.Query().Get("token"))
			result.Items[i].DownloadURL = &next
		}
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) DownloadMedia(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	token := strings.TrimSpace(c.Query("token"))
	target, err := h.media.ResolveMediaToken(c, token)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if target.WorkspaceID != key.WorkspaceID {
		httpx.WriteAppError(c, apperr.New(apperr.KindNotFound, "media not found"))
		return
	}
	result, err := h.media.PrepareDownload(c, token)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) CarbonOverview(c *gin.Context) {
	key, deviceID, ok := h.openDevice(c)
	if !ok {
		return
	}
	_ = key
	result, err := h.dataSources.CarbonOverview(c, deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) CarbonFlux(c *gin.Context) {
	_, deviceID, ok := h.openDevice(c)
	if !ok {
		return
	}
	nodeID, _ := strconv.Atoi(c.Query("node_id"))
	start, ok := parseRequiredTime(c, "start_time")
	if !ok {
		return
	}
	end, ok := parseRequiredTime(c, "end_time")
	if !ok {
		return
	}
	result, err := h.dataSources.CarbonFlux(c, deviceID, nodeID, c.Query("field"), start, end)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) CarbonPeriods(c *gin.Context) {
	_, deviceID, ok := h.openDevice(c)
	if !ok {
		return
	}
	nodeID, _ := strconv.Atoi(c.Query("node_id"))
	start, ok := parseRequiredTime(c, "start_time")
	if !ok {
		return
	}
	end, ok := parseRequiredTime(c, "end_time")
	if !ok {
		return
	}
	result, err := h.dataSources.CarbonPeriods(c, deviceID, nodeID, start, end)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": result, "total": len(result)})
}
func (h *Handler) CarbonPeriod(c *gin.Context) {
	_, deviceID, ok := h.openDevice(c)
	if !ok {
		return
	}
	nodeID, _ := strconv.Atoi(c.Query("node_id"))
	result, err := h.dataSources.CarbonPeriod(c, deviceID, nodeID, c.Query("field"), c.Query("period"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) openDevice(c *gin.Context) (APIKey, uuid.UUID, bool) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return APIKey{}, uuid.Nil, false
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return key, uuid.Nil, false
	}
	if err := h.service.DeviceBelongsToWorkspace(c, deviceID, key.WorkspaceID); err != nil {
		httpx.WriteAppError(c, err)
		return key, uuid.Nil, false
	}
	return key, deviceID, true
}
func parseRequiredTime(c *gin.Context, name string) (time.Time, bool) {
	value, err := time.Parse(time.RFC3339, c.Query(name))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return time.Time{}, false
	}
	return value, true
}

func (h *Handler) Docs(c *gin.Context) {
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.String(http.StatusOK, `<!doctype html><html><head><meta charset="utf-8"><title>THCPN Open API</title><link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:'/api/v1/open/openapi.yaml',dom_id:'#swagger-ui',deepLinking:true,persistAuthorization:true})</script></body></html>`)
}
func (h *Handler) Spec(c *gin.Context) { c.File("docs/openapi.yaml") }

func (h *Handler) DownloadExport(c *gin.Context) {
	key, ok := h.authenticateAPIKey(c)
	if !ok {
		return
	}
	jobID, ok := parseID(c, "export_job_id")
	if !ok {
		return
	}
	result, err := h.exports.PrepareAPIDownload(c.Request.Context(), jobID, key.WorkspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) authenticateAPIKey(c *gin.Context) (APIKey, bool) {
	raw, err := auth.BearerTokenFromHeader(c.GetHeader("Authorization"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing api key"))
		return APIKey{}, false
	}
	key, err := h.service.Authenticate(c.Request.Context(), raw)
	if err != nil {
		httpx.WriteAppError(c, err)
		return APIKey{}, false
	}
	return key, true
}
