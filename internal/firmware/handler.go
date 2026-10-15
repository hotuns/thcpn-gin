package firmware

import (
	"context"
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

type auditRequestKey struct{}

func firmwareRequestContext(c *gin.Context) context.Context {
	return context.WithValue(c.Request.Context(), auditRequestKey{}, audit.FromRequest(c, audit.RecordInput{}))
}

func NewHandler(service *Service, auditService *audit.Service) *Handler {
	return &Handler{service: service, audit: auditService}
}

func (h *Handler) Create(c *gin.Context) {
	if strings.HasPrefix(c.ContentType(), "application/json") {
		actor, ok := auth.ActorFromContext(c)
		if !ok || !actor.IsSystemAdmin {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "system administrator is required"))
			return
		}
		var input PublishInput
		if err := c.ShouldBindJSON(&input); err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid firmware release"))
			return
		}
		input.ActorAdminID = actor.UserID
		result, err := h.service.PublishFirmware(firmwareRequestContext(c), input)
		if err != nil {
			h.record(c, actor.UserID, "firmware.release.create", uuid.Nil, audit.ResultFailure, apperr.MessageOf(err))
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusCreated, result)
		return
	}
	h.upload(c, false)
}

func (h *Handler) UploadFirmware(c *gin.Context) { h.upload(c, true) }
func (h *Handler) upload(c *gin.Context, library bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "system administrator is required"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, MaxFileSize+(2<<20))
	if err := c.Request.ParseMultipartForm(8 << 20); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid multipart firmware upload"))
		return
	}
	defer c.Request.MultipartForm.RemoveAll()
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
	var sourceID uuid.UUID
	if library {
		values = nil
		var parseErr error
		sourceID, parseErr = uuid.Parse(c.PostForm("data_source_id"))
		if parseErr != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid data_source_id"))
			return
		}
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
	input := UploadInput{Filename: header.Filename, ContentType: header.Header.Get("Content-Type"), SizeBytes: header.Size, Body: file, Version: c.PostForm("version"), VerifyValue: c.PostForm("verify_value"), DeviceIDs: ids, BuildID: buildID, ActorAdminID: actor.UserID, IdempotencyKey: idempotencyKey}
	if library {
		input.DataSourceID = sourceID
		result, err := h.service.UploadFirmware(firmwareRequestContext(c), input)
		if err != nil {
			h.record(c, actor.UserID, "firmware.library.upload", uuid.Nil, audit.ResultFailure, apperr.MessageOf(err))
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusCreated, result)
		return
	}
	result, err := h.service.Create(firmwareRequestContext(c), input)
	if err != nil {
		h.record(c, actor.UserID, "firmware.release.create", uuid.Nil, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	h.record(c, actor.UserID, "firmware.release.create", result.ID, audit.ResultSuccess, "")
	c.JSON(http.StatusCreated, result)
}

func (h *Handler) ListFirmware(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	var result ArtifactList
	var err error
	if raw := c.Query("device_id"); raw != "" {
		id, parseErr := uuid.Parse(raw)
		if parseErr != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid device_id"))
			return
		}
		result, err = h.service.ListFirmwareForDevice(c.Request.Context(), page, size, c.Query("source_family"), id)
	} else {
		result, err = h.service.ListFirmware(c.Request.Context(), page, size, c.Query("source_family"))
	}
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}
func (h *Handler) ArchiveFirmware(c *gin.Context) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "system administrator is required"))
		return
	}
	id, err := uuid.Parse(c.Param("firmware_id"))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid firmware_id"))
		return
	}
	var input struct {
		Archived *bool `json:"archived"`
	}
	if err = c.ShouldBindJSON(&input); err != nil || input.Archived == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "archived is required"))
		return
	}
	if err = h.service.SetFirmwareArchived(firmwareRequestContext(c), id, *input.Archived, actor.UserID); err != nil {
		h.record(c, actor.UserID, "firmware.library.archive", id, audit.ResultFailure, apperr.MessageOf(err))
		httpx.WriteAppError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
func (h *Handler) Candidates(c *gin.Context) {
	var id *uuid.UUID
	if raw := c.Query("firmware_id"); raw != "" {
		parsed, err := uuid.Parse(raw)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid firmware_id"))
			return
		}
		id = &parsed
	}
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "100"))
	items, err := h.service.Candidates(c.Request.Context(), id, page, size)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
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
	if h.audit == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "audit service is not configured"))
		return
	}
	if _, err := h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorAdminID: &actor.UserID, Action: "firmware.release.retry.request", ResourceType: "firmware_release", ResourceID: &releaseID, Result: audit.ResultSuccess})); err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "record firmware retry audit", err))
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
