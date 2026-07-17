package accessgrant

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
	shareViewAction          = "share.view"
	shareCreateAction        = "share.create"
	shareRevokeAction        = "share.revoke"
	serviceAccessGrantAction = "service_access.grant"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type createGrantRequest struct {
	SubjectUserID   string     `json:"subject_user_id"`
	Email           string     `json:"email"`
	Phone           string     `json:"phone"`
	TemplateCode    string     `json:"template_code"`
	PermissionCodes []string   `json:"permission_codes"`
	ScopeType       string     `json:"scope_type"`
	ScopeID         string     `json:"scope_id"`
	ExpiresAt       *time.Time `json:"expires_at"`
	AllowReshare    bool       `json:"allow_reshare"`
	AllowAPIAccess  bool       `json:"allow_api_access"`
}

type createInvitationRequest struct {
	Email           string     `json:"email"`
	Phone           string     `json:"phone"`
	TemplateCode    string     `json:"template_code"`
	PermissionCodes []string   `json:"permission_codes"`
	ScopeType       string     `json:"scope_type"`
	ScopeID         string     `json:"scope_id"`
	ExpiresAt       *time.Time `json:"expires_at"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) ListGrants(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	scopeType, scopeID, scoped, ok := parseScopeFilter(c)
	if !ok {
		return
	}
	if scoped {
		if !h.authorize(c, scopeType, scopeID, shareViewAction) {
			return
		}
	} else if !h.authorize(c, "workspace", workspaceID, shareViewAction) {
		return
	}
	var items []AccessGrant
	var err error
	if scoped {
		items, err = h.service.ListGrantsByScope(c.Request.Context(), workspaceID, scopeType, scopeID)
	} else {
		items, err = h.service.ListGrantsByWorkspace(c.Request.Context(), workspaceID)
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListMyGrants(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	items, err := h.service.ListGrantsForUser(c.Request.Context(), actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateGrant(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createGrantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	scopeID, ok := parseUUIDValue(req.ScopeID, "scope_id", c)
	if !ok {
		return
	}
	decision, allowed := h.authorizeDecision(c, req.ScopeType, scopeID, createActionForRole(req.TemplateCode))
	if !allowed {
		return
	}

	subjectUserID, ok := parseOptionalUUIDValue(req.SubjectUserID, "subject_user_id", c)
	if !ok {
		return
	}

	result, err := h.service.CreateGrant(c.Request.Context(), CreateGrantInput{
		SubjectUserID:   subjectUserID,
		Email:           req.Email,
		Phone:           req.Phone,
		TemplateCode:    req.TemplateCode,
		PermissionCodes: req.PermissionCodes,
		ScopeType:       req.ScopeType,
		ScopeID:         scopeID,
		ExpiresAt:       req.ExpiresAt,
		AllowReshare:    req.AllowReshare,
		AllowAPIAccess:  req.AllowAPIAccess,
		ActorUserID:     actor.UserID,
		Delegated:       decision.Source == "access_grant",
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       createActionForRole(req.TemplateCode),
			ResourceType: req.ScopeType,
			ResourceID:   audit.ResourceID(scopeID),
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
		Action:       createActionForRole(result.Role.Code),
		ResourceType: "access_grant",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) RevokeGrant(c *gin.Context) {
	grantID, ok := parseUUIDParam(c, "access_grant_id")
	if !ok {
		return
	}

	current, err := h.service.GetGrant(c.Request.Context(), grantID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, current.ScopeType, current.ScopeID, revokeActionForRole(current.Role.Code)) {
		return
	}

	result, err := h.service.RevokeGrant(c.Request.Context(), grantID)
	if err != nil {
		actor, _ := auth.ActorFromContext(c)
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(current.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       revokeActionForRole(current.Role.Code),
			ResourceType: "access_grant",
			ResourceID:   audit.ResourceID(grantID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	actor, _ := auth.ActorFromContext(c)
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       revokeActionForRole(result.Role.Code),
		ResourceType: "access_grant",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) ListInvitations(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	scopeType, scopeID, scoped, ok := parseScopeFilter(c)
	if !ok {
		return
	}
	if scoped {
		if !h.authorize(c, scopeType, scopeID, shareViewAction) {
			return
		}
	} else if !h.authorize(c, "workspace", workspaceID, shareViewAction) {
		return
	}
	var items []Invitation
	var err error
	if scoped {
		items, err = h.service.ListInvitationsByScope(c.Request.Context(), workspaceID, scopeType, scopeID)
	} else {
		items, err = h.service.ListInvitationsByWorkspace(c.Request.Context(), workspaceID)
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) ListMyInvitations(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	items, err := h.service.ListPendingInvitationsForActor(c.Request.Context(), actor.Email, actor.Phone)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateInvitation(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	var req createInvitationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	scopeID, ok := parseUUIDValue(req.ScopeID, "scope_id", c)
	if !ok {
		return
	}
	decision, allowed := h.authorizeDecision(c, req.ScopeType, scopeID, createActionForRole(req.TemplateCode))
	if !allowed {
		return
	}

	result, err := h.service.CreateInvitation(c.Request.Context(), CreateInvitationInput{
		Email:           req.Email,
		Phone:           req.Phone,
		TemplateCode:    req.TemplateCode,
		PermissionCodes: req.PermissionCodes,
		ScopeType:       req.ScopeType,
		ScopeID:         scopeID,
		ExpiresAt:       req.ExpiresAt,
		ActorUserID:     actor.UserID,
		Delegated:       decision.Source == "access_grant",
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       createActionForRole(req.TemplateCode),
			ResourceType: req.ScopeType,
			ResourceID:   audit.ResourceID(scopeID),
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
		Action:       createActionForRole(result.Role.Code),
		ResourceType: "invitation",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) AcceptInvitation(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}

	invitationID, ok := parseUUIDParam(c, "invitation_id")
	if !ok {
		return
	}

	result, err := h.service.AcceptInvitation(c.Request.Context(), AcceptInvitationInput{
		InvitationID: invitationID,
		ActorUserID:  actor.UserID,
		ActorEmail:   actor.Email,
		ActorPhone:   actor.Phone,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "invitation.accept",
			ResourceType: "invitation",
			ResourceID:   audit.ResourceID(invitationID),
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
		Action:       "invitation.accept",
		ResourceType: "access_grant",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) RevokeInvitation(c *gin.Context) {
	invitationID, ok := parseUUIDParam(c, "invitation_id")
	if !ok {
		return
	}

	current, err := h.service.GetInvitation(c.Request.Context(), invitationID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.authorize(c, current.ScopeType, current.ScopeID, revokeActionForRole(current.Role.Code)) {
		return
	}

	result, err := h.service.RevokeInvitation(c.Request.Context(), invitationID)
	if err != nil {
		actor, _ := auth.ActorFromContext(c)
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(current.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       revokeActionForRole(current.Role.Code),
			ResourceType: "invitation",
			ResourceID:   audit.ResourceID(invitationID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	actor, _ := auth.ActorFromContext(c)
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       revokeActionForRole(result.Role.Code),
		ResourceType: "invitation",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	_, ok := h.authorizeDecision(c, resourceType, resourceID, action)
	return ok
}

func (h *Handler) authorizeDecision(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) (permission.Decision, bool) {
	actor, ok := actorFromContext(c)
	if !ok {
		return permission.Decision{}, false
	}
	if actor.IsSystemAdmin {
		return permission.Decision{Allowed: true, Reason: "allowed by system administrator"}, true
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return permission.Decision{}, false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return permission.Decision{}, false
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return permission.Decision{}, false
	}
	return decision, true
}

func parseScopeFilter(c *gin.Context) (string, uuid.UUID, bool, bool) {
	scopeType := strings.TrimSpace(c.Query("scope_type"))
	scopeIDValue := strings.TrimSpace(c.Query("scope_id"))
	if scopeType == "" && scopeIDValue == "" {
		return "", uuid.Nil, false, true
	}
	if scopeType == "" || scopeIDValue == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "scope_type and scope_id must be provided together"))
		return "", uuid.Nil, false, false
	}
	switch scopeType {
	case "workspace", "project", "site", "device", "dataset":
	default:
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid scope_type"))
		return "", uuid.Nil, false, false
	}
	scopeID, ok := parseUUIDValue(scopeIDValue, "scope_id", c)
	return scopeType, scopeID, true, ok
}

func createActionForRole(roleCode string) string {
	if roleCode == serviceEngineerRoleCode {
		return serviceAccessGrantAction
	}
	return shareCreateAction
}

func revokeActionForRole(roleCode string) string {
	if roleCode == serviceEngineerRoleCode {
		return serviceAccessGrantAction
	}
	return shareRevokeAction
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

func parseOptionalUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	if value == "" {
		return uuid.Nil, true
	}
	return parseUUIDValue(value, name, c)
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
