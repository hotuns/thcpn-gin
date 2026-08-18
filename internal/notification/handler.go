package notification

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

type Handler struct{ service *Service }

func NewHandler(service *Service) *Handler { return &Handler{service: service} }
func actor(c *gin.Context) (auth.Actor, bool) {
	a, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
	}
	return a, ok
}
func queryWorkspace(c *gin.Context) (*uuid.UUID, bool) {
	raw := c.Query("workspace_id")
	if raw == "" {
		return nil, true
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid workspace_id"))
		return nil, false
	}
	return &id, true
}
func paramID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid id"))
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) List(c *gin.Context) {
	a, ok := actor(c)
	if !ok {
		return
	}
	wid, ok := queryWorkspace(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	result, err := h.service.List(c, a.UserID, wid, limit)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) Read(c *gin.Context) {
	a, ok := actor(c)
	if !ok {
		return
	}
	id, ok := paramID(c)
	if !ok {
		return
	}
	if err := h.service.MarkRead(c, a.UserID, id); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) ReadAll(c *gin.Context) {
	a, ok := actor(c)
	if !ok {
		return
	}
	wid, ok := queryWorkspace(c)
	if !ok {
		return
	}
	if err := h.service.MarkAllRead(c, a.UserID, wid); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Announcements(c *gin.Context) {
	a, ok := actor(c)
	if !ok {
		return
	}
	wid, ok := queryWorkspace(c)
	if !ok {
		return
	}
	result, err := h.service.ListAnnouncements(c, a.UserID, wid, false)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) ReadAnnouncement(c *gin.Context) {
	a, ok := actor(c)
	if !ok {
		return
	}
	id, ok := paramID(c)
	if !ok {
		return
	}
	if err := h.service.MarkAnnouncementRead(c, a.UserID, id); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type announcementRequest struct {
	Title        string     `json:"title"`
	Content      string     `json:"content"`
	Level        string     `json:"level"`
	AudienceType string     `json:"audience_type"`
	Status       string     `json:"status"`
	WorkspaceID  *uuid.UUID `json:"workspace_id"`
	ExpiresAt    *time.Time `json:"expires_at"`
}
type statusRequest struct {
	Status string `json:"status"`
}
type sendRequest struct {
	UserID      *uuid.UUID `json:"user_id"`
	WorkspaceID *uuid.UUID `json:"workspace_id"`
	Category    string     `json:"category"`
	Level       string     `json:"level"`
	Title       string     `json:"title"`
	Content     string     `json:"content"`
	ActionURL   string     `json:"action_url"`
	ExpiresAt   *time.Time `json:"expires_at"`
}

func (h *Handler) AdminListAnnouncements(c *gin.Context) {
	a, ok := actor(c)
	if !ok || !a.IsSystemAdmin {
		return
	}
	result, err := h.service.ListAnnouncements(c, a.UserID, nil, true)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) AdminCreateAnnouncement(c *gin.Context) {
	a, ok := actor(c)
	if !ok || !a.IsSystemAdmin {
		return
	}
	var req announcementRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	result, err := h.service.CreateAnnouncement(c, a.UserID, AnnouncementInput{Title: req.Title, Content: req.Content, Level: req.Level, AudienceType: req.AudienceType, Status: req.Status, WorkspaceID: req.WorkspaceID, ExpiresAt: req.ExpiresAt})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, result)
}
func (h *Handler) AdminSetAnnouncementStatus(c *gin.Context) {
	a, ok := actor(c)
	if !ok || !a.IsSystemAdmin {
		return
	}
	id, ok := paramID(c)
	if !ok {
		return
	}
	var req statusRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if err := h.service.SetAnnouncementStatus(c, id, req.Status); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) AdminSend(c *gin.Context) {
	a, ok := actor(c)
	if !ok || !a.IsSystemAdmin {
		return
	}
	var req sendRequest
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	count, err := h.service.Send(c, SendInput{UserID: req.UserID, WorkspaceID: req.WorkspaceID, Category: req.Category, Level: req.Level, Title: req.Title, Content: req.Content, ActionURL: req.ActionURL, ExpiresAt: req.ExpiresAt})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, gin.H{"created_count": count})
}
