package audit

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const auditViewAction = "audit.view"

type Handler struct {
	service   *Service
	checker   *permission.Checker
	actorFunc func(*gin.Context) (uuid.UUID, bool)
	adminFunc func(*gin.Context) bool
}

func NewHandler(service *Service, checker *permission.Checker, actorFunc func(*gin.Context) (uuid.UUID, bool), adminFuncs ...func(*gin.Context) bool) *Handler {
	var adminFunc func(*gin.Context) bool
	if len(adminFuncs) > 0 {
		adminFunc = adminFuncs[0]
	}
	return &Handler{service: service, checker: checker, actorFunc: actorFunc, adminFunc: adminFunc}
}

func (h *Handler) List(c *gin.Context) {
	workspaceID, ok := parseUUIDValue(c.Query("workspace_id"), "workspace_id", c)
	if !ok {
		return
	}
	if !h.authorize(c, workspaceID) {
		return
	}

	result, err := h.service.ListPageByWorkspace(c.Request.Context(), ListInput{
		WorkspaceID:  workspaceID,
		Limit:        ParseLimit(c.Query("limit")),
		Page:         parseInt(c.Query("page"), 1),
		PageSize:     parseInt(c.Query("page_size"), int(ParseLimit(c.Query("limit")))),
		Action:       c.Query("action"),
		ResourceType: c.Query("resource_type"),
		Result:       c.Query("result"),
		ActorType:    c.Query("actor_type"),
		Start:        parseOptionalTime(c.Query("start")),
		End:          parseOptionalTime(c.Query("end")),
	})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	c.JSON(http.StatusOK, result)
}

func parseInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}

func parseOptionalTime(value string) *time.Time {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil
	}
	return &parsed
}

func (h *Handler) authorize(c *gin.Context, workspaceID uuid.UUID) bool {
	if h.adminFunc != nil && h.adminFunc(c) {
		return true
	}
	userID, ok := h.actorUserID(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: userID}, auditViewAction, permission.ResourceRef{
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

func (h *Handler) actorUserID(c *gin.Context) (uuid.UUID, bool) {
	if h.actorFunc == nil {
		return uuid.Nil, false
	}
	return h.actorFunc(c)
}

func parseUUIDValue(value string, name string, c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
}
