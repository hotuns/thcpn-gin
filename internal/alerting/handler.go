package alerting

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

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

type ruleRequest struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	Severity     string  `json:"severity"`
	DeviceID     string  `json:"device_id"`
	DataStreamID *string `json:"data_stream_id"`
	Condition    struct {
		Mode            *string  `json:"mode"`
		Lower           *float64 `json:"lower"`
		Upper           *float64 `json:"upper"`
		DurationSeconds int      `json:"duration_seconds"`
		RecoveryDelta   float64  `json:"recovery_delta"`
	} `json:"condition"`
	OfflineAfterSeconds *int     `json:"offline_after_seconds"`
	RecipientUserIDs    []string `json:"recipient_user_ids"`
	Channels            []string `json:"channels"`
	Enabled             *bool    `json:"enabled"`
}

func (h *Handler) ListRules(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "workspace.view", false)
	if !ok {
		return
	}
	items, err := h.service.ListRules(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) ListEvents(c *gin.Context) {
	workspaceID, _, ok := h.authorize(c, "workspace.view", false)
	if !ok {
		return
	}
	filter := EventFilter{Status: c.Query("status"), Severity: c.Query("severity")}
	if raw := c.Query("device_id"); raw != "" {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
			return
		}
		filter.DeviceID = &id
	}
	if raw := c.Query("limit"); raw != "" {
		filter.Limit, _ = strconv.Atoi(raw)
	}
	items, err := h.service.ListEvents(c.Request.Context(), workspaceID, filter)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateRule(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "workspace.manage", true)
	if !ok {
		return
	}
	input, ok := parseRuleRequest(c)
	if !ok {
		return
	}
	item, err := h.service.CreateRule(c.Request.Context(), workspaceID, actor.UserID, input)
	if !h.record(c, workspaceID, actor.UserID, "alert_rule.create", item.ID, err) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}
func (h *Handler) UpdateRule(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "workspace.manage", true)
	if !ok {
		return
	}
	ruleID, ok := parseID(c, "rule_id")
	if !ok {
		return
	}
	input, ok := parseRuleRequest(c)
	if !ok {
		return
	}
	item, err := h.service.UpdateRule(c.Request.Context(), workspaceID, ruleID, input)
	if !h.record(c, workspaceID, actor.UserID, "alert_rule.update", ruleID, err) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) DeleteRule(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "workspace.manage", true)
	if !ok {
		return
	}
	ruleID, ok := parseID(c, "rule_id")
	if !ok {
		return
	}
	err := h.service.ArchiveRule(c.Request.Context(), workspaceID, ruleID)
	if !h.record(c, workspaceID, actor.UserID, "alert_rule.archive", ruleID, err) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Acknowledge(c *gin.Context) {
	workspaceID, actor, ok := h.authorize(c, "workspace.view", false)
	if !ok {
		return
	}
	eventID, ok := parseID(c, "event_id")
	if !ok {
		return
	}
	item, err := h.service.Acknowledge(c.Request.Context(), workspaceID, eventID, actor.UserID)
	if !h.record(c, workspaceID, actor.UserID, "alert_event.acknowledge", eventID, err) {
		return
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) authorize(c *gin.Context, action string, ownerAdmin bool) (uuid.UUID, auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return uuid.Nil, auth.Actor{}, false
	}
	workspaceID, ok := parseID(c, "workspace_id")
	if !ok {
		return uuid.Nil, actor, false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return uuid.Nil, actor, false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{Type: "workspace", ID: workspaceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return uuid.Nil, actor, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return uuid.Nil, actor, false
	}
	if ownerAdmin {
		allowed, err := h.service.IsOwnerOrAdmin(c.Request.Context(), workspaceID, actor.UserID)
		if err != nil {
			httpx.WriteAppError(c, err)
			return uuid.Nil, actor, false
		}
		if !allowed {
			httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "workspace owner or admin required"))
			return uuid.Nil, actor, false
		}
	}
	return workspaceID, actor, true
}

func parseRuleRequest(c *gin.Context) (RuleInput, bool) {
	var req ruleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return RuleInput{}, false
	}
	deviceID, err := uuid.Parse(req.DeviceID)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return RuleInput{}, false
	}
	var streamID *uuid.UUID
	if req.DataStreamID != nil && *req.DataStreamID != "" {
		parsed, err := uuid.Parse(*req.DataStreamID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid data_stream_id"))
			return RuleInput{}, false
		}
		streamID = &parsed
	}
	recipients := make([]uuid.UUID, 0, len(req.RecipientUserIDs))
	for _, raw := range req.RecipientUserIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid recipient_user_ids"))
			return RuleInput{}, false
		}
		recipients = append(recipients, id)
	}
	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	duration := req.Condition.DurationSeconds
	if duration == 0 {
		duration = 300
	}
	return RuleInput{Name: req.Name, Type: req.Type, Severity: req.Severity, DeviceID: deviceID, DataStreamID: streamID, ConditionMode: req.Condition.Mode, Lower: req.Condition.Lower, Upper: req.Condition.Upper, DurationSeconds: duration, RecoveryDelta: req.Condition.RecoveryDelta, OfflineAfterSeconds: req.OfflineAfterSeconds, Channels: req.Channels, RecipientUserIDs: recipients, Enabled: enabled}, true
}
func parseID(c *gin.Context, key string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(key))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+key))
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) record(c *gin.Context, workspaceID, userID uuid.UUID, action string, resourceID uuid.UUID, operationErr error) bool {
	if h.audit == nil {
		return true
	}
	result := audit.ResultSuccess
	reason := ""
	if operationErr != nil {
		result = audit.ResultFailure
		reason = apperr.MessageOf(operationErr)
	}
	_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(workspaceID), ActorType: audit.ActorUser, ActorID: audit.UserActorID(userID), Action: action, ResourceType: "alert", ResourceID: audit.ResourceID(resourceID), Result: result, Reason: reason}))
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
