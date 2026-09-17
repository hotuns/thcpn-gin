package demoshowcase

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

func NewHandler(service *Service, audits ...*audit.Service) *Handler {
	var a *audit.Service
	if len(audits) > 0 {
		a = audits[0]
	}
	return &Handler{service: service, audit: a}
}
func parseUserID(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid user_id"))
		return uuid.Nil, false
	}
	return id, true
}
func (h *Handler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context())
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Get(c *gin.Context) {
	id, ok := parseUserID(c)
	if !ok {
		return
	}
	item, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) Create(c *gin.Context) {
	var req struct {
		Username string `json:"username"`
		Name     string `json:"name"`
		Password string `json:"password"`
	}
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Create(c.Request.Context(), req.Username, req.Name, req.Password)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusCreated, item)
}
func (h *Handler) Update(c *gin.Context) {
	id, ok := parseUserID(c)
	if !ok {
		return
	}
	var req struct {
		Name   *string `json:"name"`
		Status *string `json:"status"`
	}
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	item, err := h.service.Update(c.Request.Context(), id, req.Name, req.Status)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}
func (h *Handler) ResetPassword(c *gin.Context) {
	id, ok := parseUserID(c)
	if !ok {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if c.ShouldBindJSON(&req) != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	if err := h.service.ResetPassword(c.Request.Context(), id, req.Password); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Devices(c *gin.Context) {
	id, ok := parseUserID(c)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	items, total, err := h.service.ListDevices(c.Request.Context(), id, c.Query("q"), limit, offset)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "limit": limit, "offset": offset})
}
func (h *Handler) Add(c *gin.Context) {
	userID, ok := parseUserID(c)
	if !ok {
		return
	}
	actor, ok := adminauth.ActorFromContext(c)
	if !ok {
		return
	}
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	if err = h.service.AddDevice(c.Request.Context(), userID, deviceID, actor.UserID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Remove(c *gin.Context) {
	userID, ok := parseUserID(c)
	if !ok {
		return
	}
	deviceID, err := uuid.Parse(c.Param("device_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
		return
	}
	if err = h.service.RemoveDevice(c.Request.Context(), userID, deviceID); err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
