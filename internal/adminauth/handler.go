package adminauth

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}
type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}
type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

func (h *Handler) Login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Login(c.Request.Context(), LoginInput{Email: req.Email, Password: req.Password, UserAgent: c.GetHeader("User-Agent"), ClientIP: c.ClientIP()})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Refresh(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.Refresh(c.Request.Context(), req.RefreshToken, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Logout(c *gin.Context) {
	var req refreshRequest
	if err := c.ShouldBindJSON(&req); err == nil {
		_ = h.service.Logout(c.Request.Context(), req.RefreshToken)
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) Me(c *gin.Context) {
	actor, ok := ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing administrator session"))
		return
	}
	c.JSON(http.StatusOK, gin.H{"admin": Admin{ID: actor.UserID.String(), Name: actor.Name, Email: value(actor.Email), Status: actor.Status}})
}

func (h *Handler) ChangePassword(c *gin.Context) {
	actor, ok := ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing administrator session"))
		return
	}
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if err := h.service.ChangePassword(c.Request.Context(), actor.UserID, req.CurrentPassword, req.NewPassword); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"signed_out": true})
}

func value(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
