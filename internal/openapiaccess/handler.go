package openapiaccess

import (
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
	"thcpn-gin/internal/telemetry"
)

type Handler struct {
	service   *Service
	telemetry *telemetry.Service
	checker   *permission.Checker
	audit     *audit.Service
}

func NewHandler(service *Service, telemetryService *telemetry.Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, telemetry: telemetryService, checker: checker, audit: auditService}
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
	raw, err := auth.BearerTokenFromHeader(c.GetHeader("Authorization"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing api key"))
		return
	}
	key, err := h.service.Authenticate(c.Request.Context(), raw)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	deviceID, ok := parseID(c, "device_id")
	if !ok {
		return
	}
	if err = h.service.DeviceBelongsToWorkspace(c.Request.Context(), deviceID, key.WorkspaceID); err != nil {
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
