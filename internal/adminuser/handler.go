package adminuser

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
)

type Handler struct {
	service *Service
	audit   *audit.Service
}

type createRequest struct {
	Name   string `json:"name"`
	Email  string `json:"email"`
	Phone  string `json:"phone"`
	Reason string `json:"reason"`
}
type updateRequest struct {
	Name   string  `json:"name"`
	Email  *string `json:"email"`
	Phone  *string `json:"phone"`
	Reason string  `json:"reason"`
}
type reasonRequest struct {
	Reason      string `json:"reason"`
	ConfirmText string `json:"confirm_text"`
}
type statusRequest struct {
	Status      string `json:"status"`
	Reason      string `json:"reason"`
	ConfirmText string `json:"confirm_text"`
}

func NewHandler(service *Service, auditService *audit.Service) *Handler {
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) List(c *gin.Context) {
	result, err := h.service.List(c.Request.Context(), ListInput{Search: c.Query("q"), Status: c.Query("status"), Verification: c.Query("verification"), MFA: c.Query("mfa"), Locked: c.Query("locked"), LoginStatus: c.Query("login_status"), Sort: c.Query("sort"), Order: c.Query("order"), Page: positive(c.Query("page"), 1), PageSize: positive(c.Query("page_size"), 20)})
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Create(c *gin.Context) {
	var req createRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) {
		return
	}
	item, temporary, err := h.service.Create(c.Request.Context(), CreateInput{Name: req.Name, Email: req.Email, Phone: req.Phone})
	if err != nil {
		h.fail(c, "admin.user.create", uuid.Nil, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.create", item.ID, req.Reason) {
		return
	}
	c.JSON(http.StatusCreated, gin.H{"user": item, "temporary_password": temporary})
}

func (h *Handler) Get(c *gin.Context) {
	id, ok := idParam(c)
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

func (h *Handler) Update(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req updateRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) {
		return
	}
	item, err := h.service.Update(c.Request.Context(), id, UpdateInput{Name: req.Name, Email: req.Email, Phone: req.Phone})
	if err != nil {
		h.fail(c, "admin.user.update", id, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.update", id, req.Reason) {
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) Workspaces(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	items, err := h.service.Workspaces(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}
func (h *Handler) Sessions(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	items, err := h.service.Sessions(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) Activity(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	items, total, err := h.service.Activity(c.Request.Context(), id, positive(c.Query("page"), 1), positive(c.Query("page_size"), 50))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "total": total, "page": positive(c.Query("page"), 1), "page_size": positive(c.Query("page_size"), 50)})
}

func (h *Handler) DeletionCheck(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	item, err := h.service.DeletionCheck(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, item)
}

func (h *Handler) Status(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req statusRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) || !validConfirm(c, req.ConfirmText, "确认") {
		return
	}
	if err := h.service.UpdateStatus(c.Request.Context(), id, req.Status); err != nil {
		h.fail(c, "admin.user.status", id, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.status", id, req.Reason) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) RevokeAllSessions(c *gin.Context) {
	h.reasonAction(c, "admin.user.sessions_revoke_all", func(id uuid.UUID) error { return h.service.RevokeAllSessions(c.Request.Context(), id) })
}
func (h *Handler) Unlock(c *gin.Context) {
	h.reasonAction(c, "admin.user.unlock", func(id uuid.UUID) error { return h.service.Unlock(c.Request.Context(), id) })
}

func (h *Handler) ResetMFA(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req reasonRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) || !validConfirm(c, req.ConfirmText, "重置 MFA") {
		return
	}
	if err := h.service.ResetMFA(c.Request.Context(), id); err != nil {
		h.fail(c, "admin.user.mfa_reset", id, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.mfa_reset", id, req.Reason) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) TemporaryPassword(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req reasonRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) || !validConfirm(c, req.ConfirmText, "重置密码") {
		return
	}
	password, err := h.service.TemporaryPassword(c.Request.Context(), id)
	if err != nil {
		h.fail(c, "admin.user.password_reset", id, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.password_reset", id, req.Reason) {
		return
	}
	c.JSON(http.StatusOK, gin.H{"temporary_password": password})
}

func (h *Handler) Delete(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req reasonRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) || !validConfirm(c, req.ConfirmText, "删除用户") {
		return
	}
	if err := h.service.Delete(c.Request.Context(), id); err != nil {
		h.fail(c, "admin.user.delete", id, req.Reason, err)
		return
	}
	if !h.success(c, "admin.user.delete", id, req.Reason) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) reasonAction(c *gin.Context, action string, fn func(uuid.UUID) error) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var req reasonRequest
	if !bind(c, &req) {
		return
	}
	if !validReason(c, req.Reason) {
		return
	}
	if err := fn(id); err != nil {
		h.fail(c, action, id, req.Reason, err)
		return
	}
	if !h.success(c, action, id, req.Reason) {
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) success(c *gin.Context, action string, id uuid.UUID, reason string) bool {
	return h.record(c, audit.RecordInput{Action: action, ResourceType: "user", ResourceID: audit.ResourceID(id), Result: audit.ResultSuccess, Reason: reason})
}
func (h *Handler) fail(c *gin.Context, action string, id uuid.UUID, reason string, err error) {
	if h.record(c, audit.RecordInput{Action: action, ResourceType: "user", ResourceID: audit.ResourceID(id), Result: audit.ResultFailure, Reason: reason + ": " + apperr.MessageOf(err)}) {
		httpx.WriteAppError(c, err)
	}
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

func bind(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return false
	}
	return true
}
func validReason(c *gin.Context, reason string) bool {
	if len([]rune(strings.TrimSpace(reason))) < 5 {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "reason must contain at least 5 characters"))
		return false
	}
	return true
}
func validConfirm(c *gin.Context, actual, expected string) bool {
	if strings.TrimSpace(actual) != expected {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "confirmation text is required"))
		return false
	}
	return true
}
func idParam(c *gin.Context) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid user_id"))
		return uuid.Nil, false
	}
	return id, true
}
func positive(value string, fallback int) int {
	n, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || n < 1 {
		return fallback
	}
	return n
}
