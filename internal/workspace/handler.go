package workspace

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

type createWorkspaceRequest struct {
	Name             string `json:"name"`
	OrganizationType string `json:"organization_type"`
}

type workspaceStatusRequest struct {
	Status      string `json:"status"`
	ConfirmText string `json:"confirm_text"`
}

type transferOwnerRequest struct {
	OwnerUserID string `json:"owner_user_id"`
	ConfirmText string `json:"confirm_text"`
}

func NewHandler(service *Service, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}

	items, err := h.service.ListForUser(c.Request.Context(), actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"items": items,
	})
}

func (h *Handler) AdminList(c *gin.Context) {
	result, err := h.service.AdminListGovernance(c.Request.Context(), GovernanceListInput{
		Search:           c.Query("q"),
		WorkspaceType:    c.Query("type"),
		OrganizationType: c.Query("organization_type"),
		Status:           c.Query("status"),
		Risk:             c.Query("risk"),
		Sort:             c.Query("sort"),
		Order:            c.Query("order"),
		Page:             parsePositiveInt(c.Query("page"), 1),
		PageSize:         parsePositiveInt(c.Query("page_size"), 20),
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminGet(c *gin.Context) {
	workspaceID, ok := parseUUIDParam(c, "workspace_id")
	if !ok {
		return
	}
	item, err := h.service.AdminGetGovernance(c.Request.Context(), workspaceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) AdminUpdateStatus(c *gin.Context) {
	workspaceID, ok := parseUUIDParam(c, "workspace_id")
	if !ok {
		return
	}
	var req workspaceStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if req.ConfirmText != "确认" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "confirmation text is required"))
		return
	}
	item, err := h.service.AdminUpdateStatus(c.Request.Context(), workspaceID, req.Status)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(workspaceID), Action: "workspace.status.update", ResourceType: "workspace", ResourceID: audit.ResourceID(workspaceID), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) AdminTransferOwner(c *gin.Context) {
	workspaceID, ok := parseUUIDParam(c, "workspace_id")
	if !ok {
		return
	}
	var req transferOwnerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if req.ConfirmText != "转移 Owner" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "confirmation text is required"))
		return
	}
	targetID, err := uuid.Parse(req.OwnerUserID)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid owner_user_id"))
		return
	}
	item, err := h.service.AdminTransferOwner(c.Request.Context(), workspaceID, targetID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(workspaceID), Action: "workspace.owner.transfer", ResourceType: "workspace", ResourceID: audit.ResourceID(workspaceID), Result: audit.ResultSuccess}) {
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) TenantManagedOperation(c *gin.Context) {
	httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "creation is managed by the Workspace owner in the user platform"))
}

func (h *Handler) RequireAdminReason() gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, ok := auth.ActorFromContext(c)
		if !ok || !actor.IsSystemAdmin {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing system administrator"))
			c.Abort()
			return
		}
		reason := strings.TrimSpace(c.GetHeader("X-Admin-Reason"))
		if len([]rune(reason)) < 5 {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "administrator operation reason must contain at least 5 characters"))
			c.Abort()
			return
		}
		c.Set("admin_operation_reason", reason)
		c.Next()
	}
}

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}

func parsePositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func (h *Handler) Create(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}

	var req createWorkspaceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}

	result, err := h.service.CreateOrganization(c.Request.Context(), CreateOrganizationInput{
		Name:             req.Name,
		OrganizationType: req.OrganizationType,
		OwnerUserID:      actor.UserID,
	})
	if err != nil {
		if !h.record(c, audit.RecordInput{
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       "workspace.create",
			ResourceType: "workspace",
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.Workspace.ID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       "workspace.create",
		ResourceType: "workspace",
		ResourceID:   audit.ResourceID(result.Workspace.ID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusCreated, result)
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
