package deviceclaim

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/adminauth"
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

type resolveRequest struct {
	ClaimSlug string `json:"claim_slug"`
	SerialNo  string `json:"serial_no"`
	Code      string `json:"code"`
}

type claimRequest struct {
	resolveRequest
	WorkspaceID string `json:"workspace_id"`
	ProjectID   string `json:"project_id"`
	SiteID      string `json:"site_id"`
}

func NewHandler(service *Service, checker *permission.Checker, auditService *audit.Service) *Handler {
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) PublicEntry(c *gin.Context) {
	if strings.TrimSpace(c.Param("claim_slug")) == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindNotFound, "device is not available for claiming"))
		return
	}
	c.Header("X-Robots-Tag", "noindex, nofollow")
	c.JSON(http.StatusOK, gin.H{"login_required": true})
}

func (h *Handler) Resolve(c *gin.Context) {
	var req resolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Resolve(c.Request.Context(), ResolveInput{
		ClaimSlug: req.ClaimSlug, SerialNo: req.SerialNo, Code: req.Code,
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Claim(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing user session"))
		return
	}
	var req claimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	workspaceID, err := uuid.Parse(req.WorkspaceID)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "device.bind", permission.ResourceRef{Type: "workspace", ID: workspaceID})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !decision.Allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "device bind permission is required"))
		return
	}
	projectID, ok := optionalUUID(req.ProjectID, "project_id", c)
	if !ok {
		return
	}
	siteID, ok := optionalUUID(req.SiteID, "site_id", c)
	if !ok {
		return
	}
	result, err := h.service.Claim(c.Request.Context(), ClaimInput{
		ResolveInput: ResolveInput{ClaimSlug: req.ClaimSlug, SerialNo: req.SerialNo, Code: req.Code},
		UserID:       actor.UserID, WorkspaceID: workspaceID, ProjectID: projectID, SiteID: siteID,
		IdempotencyKey: c.GetHeader("Idempotency-Key"),
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if h.audit != nil {
		_, err = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{
			WorkspaceID: audit.WorkspaceID(result.WorkspaceID),
			ActorType:   audit.ActorUser, ActorID: audit.UserActorID(actor.UserID),
			Action: "device.claim", ResourceType: "device", ResourceID: audit.ResourceID(result.DeviceID),
			Result: audit.ResultSuccess,
		}))
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminCredential(c *gin.Context) {
	if _, ok := adminauth.ActorFromContext(c); !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing administrator session"))
		return
	}
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	result, err := h.service.GetAdminCredential(c.Request.Context(), deviceID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminEnsureAll(c *gin.Context) {
	if _, ok := adminauth.ActorFromContext(c); !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing administrator session"))
		return
	}
	count, err := h.service.EnsureEligible(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"created": count})
}

func (h *Handler) AdminMarkPrinted(c *gin.Context) {
	if _, ok := adminauth.ActorFromContext(c); !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing administrator session"))
		return
	}
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	if err := h.service.MarkPrinted(c.Request.Context(), deviceID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func optionalUUID(value, field string, c *gin.Context) (*uuid.UUID, bool) {
	if strings.TrimSpace(value) == "" {
		return nil, true
	}
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+field))
		return nil, false
	}
	return &id, true
}
