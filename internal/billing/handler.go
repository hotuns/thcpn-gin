package billing

import (
	"net/http"
	"time"

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

type grantRequest struct {
	SourceType     string     `json:"source_type"`
	ReferenceNo    string     `json:"reference_no"`
	AmountCents    int64      `json:"amount_cents"`
	StartsAt       *time.Time `json:"starts_at"`
	EndsAt         *time.Time `json:"ends_at"`
	DurationMonths int        `json:"duration_months"`
	Reason         string     `json:"reason"`
}
type trafficPackRequest struct {
	Bytes       int64  `json:"bytes"`
	PriceCents  int64  `json:"price_cents"`
	ReferenceNo string `json:"reference_no"`
	Reason      string `json:"reason"`
}

func parseWorkspaceID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("workspace_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) userCanView(c *gin.Context, id uuid.UUID) bool {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return false
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, "workspace.view", permission.ResourceRef{Type: "workspace", ID: id})
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
func adminActor(c *gin.Context) (uuid.UUID, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing system administrator"))
		return uuid.Nil, false
	}
	return actor.UserID, true
}

func (h *Handler) Get(c *gin.Context) {
	id, ok := parseWorkspaceID(c)
	if !ok || !h.userCanView(c, id) {
		return
	}
	result, err := h.service.Summary(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminGet(c *gin.Context) {
	id, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if _, ok = adminActor(c); !ok {
		return
	}
	result, err := h.service.Summary(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminHistory(c *gin.Context) {
	id, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	if _, ok = adminActor(c); !ok {
		return
	}
	result, err := h.service.History(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) AdminRisks(c *gin.Context) {
	if _, ok := adminActor(c); !ok {
		return
	}
	result, err := h.service.AdminRiskWorkspaces(c.Request.Context(), c.Query("risk"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": result})
}

func (h *Handler) AdminGrantProfessional(c *gin.Context) {
	id, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	adminID, ok := adminActor(c)
	if !ok {
		return
	}
	var req grantRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.GrantProfessional(c.Request.Context(), id, adminID, GrantProfessionalInput{SourceType: req.SourceType, ReferenceNo: req.ReferenceNo, AmountCents: req.AmountCents, StartsAt: req.StartsAt, EndsAt: req.EndsAt, DurationMonths: req.DurationMonths, Reason: req.Reason})
	if err != nil {
		h.record(c, id, "billing.professional.grant", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, id, "billing.professional.grant", audit.ResultSuccess, req.Reason) {
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminAddTrafficPack(c *gin.Context) {
	id, ok := parseWorkspaceID(c)
	if !ok {
		return
	}
	adminID, ok := adminActor(c)
	if !ok {
		return
	}
	var req trafficPackRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.AddTrafficPack(c.Request.Context(), id, adminID, AddTrafficPackInput{Bytes: req.Bytes, PriceCents: req.PriceCents, ReferenceNo: req.ReferenceNo, Reason: req.Reason})
	if err != nil {
		h.record(c, id, "billing.traffic_pack.add", audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, id, "billing.traffic_pack.add", audit.ResultSuccess, req.Reason) {
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) record(c *gin.Context, workspaceID uuid.UUID, action, result, reason string) bool {
	if h.audit == nil {
		return true
	}
	_, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{WorkspaceID: audit.WorkspaceID(workspaceID), Action: action, ResourceType: "workspace_billing", ResourceID: audit.ResourceID(workspaceID), Result: result, Reason: reason}))
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	return true
}
