package firmware

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

func NewHandler(service *Service, auditService *audit.Service) *Handler {
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) Create(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxFileSize+(2<<20))
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid multipart firmware upload"))
		return
	}
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "firmware file is required"))
		return
	}
	defer file.Close()
	values := c.Request.MultipartForm.Value["device_ids[]"]
	if len(values) == 0 {
		values = c.Request.MultipartForm.Value["device_ids"]
	}
	ids := make([]uuid.UUID, 0, len(values))
	for _, raw := range values {
		id, parseErr := uuid.Parse(strings.TrimSpace(raw))
		if parseErr != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
			return
		}
		ids = append(ids, id)
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "system administrator is required"))
		return
	}
	idempotencyKey, parseErr := uuid.Parse(strings.TrimSpace(c.PostForm("idempotency_key")))
	if parseErr != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid idempotency_key"))
		return
	}
	var buildID *int64
	if raw := strings.TrimSpace(c.PostForm("build_id")); raw != "" {
		parsed, buildErr := strconv.ParseInt(raw, 10, 64)
		if buildErr != nil || parsed <= 0 {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "build_id must be a positive integer"))
			return
		}
		buildID = &parsed
	}
	result, err := h.service.Create(c.Request.Context(), UploadInput{Filename: header.Filename, ContentType: header.Header.Get("Content-Type"), SizeBytes: header.Size, Body: file, Version: c.PostForm("version"), VerifyValue: c.PostForm("verify_value"), DeviceIDs: ids, BuildID: buildID, ActorAdminID: actor.UserID, IdempotencyKey: idempotencyKey})
	if err != nil {
		h.record(c, actor.UserID, "firmware.release.create", uuid.Nil, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, actor.UserID, "firmware.release.create", result.ID, audit.ResultSuccess, "")
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := h.service.List(c.Request.Context(), page, size, c.Query("status"), c.Query("version"), c.Query("device"), c.Query("source_family"))
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Get(c *gin.Context) {
	id, err := uuid.Parse(c.Param("release_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid release_id"))
		return
	}
	result, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Retry(c *gin.Context) {
	releaseID, err1 := uuid.Parse(c.Param("release_id"))
	targetID, err2 := uuid.Parse(c.Param("target_id"))
	if err1 != nil || err2 != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid firmware release target"))
		return
	}
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "system administrator is required"))
		return
	}
	result, err := h.service.Retry(c.Request.Context(), releaseID, targetID)
	if err != nil {
		h.record(c, actor.UserID, "firmware.release.retry", releaseID, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, actor.UserID, "firmware.release.retry", releaseID, audit.ResultSuccess, "")
	c.JSON(http.StatusOK, result)
}

func (h *Handler) record(c *gin.Context, adminID uuid.UUID, action string, resourceID uuid.UUID, result, reason string) {
	if h.audit == nil {
		return
	}
	var id *uuid.UUID
	if resourceID != uuid.Nil {
		id = &resourceID
	}
	_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorAdminID: &adminID, Action: action, ResourceType: "firmware_release", ResourceID: id, Result: result, Reason: reason}))
}
