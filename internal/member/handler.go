package member

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

const memberManageAction = "member.manage"

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

type addMemberRequest struct {
	UserID          string   `json:"user_id"`
	Email           string   `json:"email"`
	Phone           string   `json:"phone"`
	TemplateCode    string   `json:"template_code"`
	PermissionCodes []string `json:"permission_codes"`
	ScopeType       string   `json:"scope_type"`
	ScopeID         string   `json:"scope_id"`
}

type updateMemberRoleRequest struct {
	TemplateCode    string   `json:"template_code"`
	PermissionCodes []string `json:"permission_codes"`
	ScopeType       string   `json:"scope_type"`
	ScopeID         string   `json:"scope_id"`
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}

	items, err := h.service.List(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Add(c *gin.Context) {
	workspaceID, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	var req addMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	userID := uuid.Nil
	if req.UserID != "" {
		parsed, err := uuid.Parse(req.UserID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid user_id"))
			return
		}
		userID = parsed
	}
	scopeID, ok := parseOptionalRequestUUID(req.ScopeID, "scope_id", c)
	if !ok {
		return
	}

	result, err := h.service.Add(c.Request.Context(), AddInput{
		WorkspaceID:     workspaceID,
		UserID:          userID,
		Email:           req.Email,
		Phone:           req.Phone,
		TemplateCode:    req.TemplateCode,
		PermissionCodes: req.PermissionCodes,
		ScopeType:       req.ScopeType,
		ScopeID:         scopeID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "member.add",
			ResourceType: "workspace",
			ResourceID:   audit.ResourceID(workspaceID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(workspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "member.add",
		ResourceType: "workspace_member",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
}

func (h *Handler) UpdateRole(c *gin.Context) {
	workspaceID, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	memberID, ok := parseMemberID(c)
	if !ok {
		return
	}

	var req updateMemberRoleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	scopeID, ok := parseOptionalRequestUUID(req.ScopeID, "scope_id", c)
	if !ok {
		return
	}

	result, err := h.service.UpdateRole(c.Request.Context(), UpdateRoleInput{
		WorkspaceID:     workspaceID,
		MemberID:        memberID,
		TemplateCode:    req.TemplateCode,
		PermissionCodes: req.PermissionCodes,
		ScopeType:       req.ScopeType,
		ScopeID:         scopeID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "member.role_update",
			ResourceType: "workspace_member",
			ResourceID:   audit.ResourceID(memberID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(workspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "member.role_update",
		ResourceType: "workspace_member",
		ResourceID:   audit.ResourceID(result.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) Remove(c *gin.Context) {
	workspaceID, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}
	actor, _ := auth.ActorFromContext(c)

	memberID, ok := parseMemberID(c)
	if !ok {
		return
	}

	if err := h.service.Remove(c.Request.Context(), RemoveInput{
		WorkspaceID: workspaceID,
		MemberID:    memberID,
	}); err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(workspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "member.remove",
			ResourceType: "workspace_member",
			ResourceID:   audit.ResourceID(memberID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(workspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "member.remove",
		ResourceType: "workspace_member",
		ResourceID:   audit.ResourceID(memberID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.Status(http.StatusNoContent)
}

func (h *Handler) authorize(c *gin.Context, workspaceID uuid.UUID) bool {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, memberManageAction, permission.ResourceRef{
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

func parseWorkspaceID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("workspace_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return uuid.Nil, false
	}
	return id, true
}

func parseMemberID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("member_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid member_id"))
		return uuid.Nil, false
	}
	return id, true
}

func parseOptionalRequestUUID(value string, field string, c *gin.Context) (uuid.UUID, bool) {
	if value == "" {
		return uuid.Nil, true
	}
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+field))
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
