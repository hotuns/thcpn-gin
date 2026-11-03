package dashboard

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

func (h *Handler) Get(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return
	}
	workspaceID, err := uuid.Parse(c.Param("workspace_id"))
	if err != nil || workspaceID == uuid.Nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return
	}
	days, err := strconv.Atoi(c.DefaultQuery("days", "7"))
	if err != nil || (days != 7 && days != 30) {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "days must be 7 or 30"))
		return
	}
	result, err := h.service.Overview(c.Request.Context(), actor, workspaceID, days)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, result)
}
