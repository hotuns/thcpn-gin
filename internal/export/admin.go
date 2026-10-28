package export

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/httpx"
)

// Administrator jobs have their own requester and no workspace owner. They use
// the same bounded, asynchronous archive pipeline as user exports.
func (s *Service) CreateAdmin(ctx context.Context, adminID uuid.UUID, input CreateInput) (Job, error) {
	if adminID == uuid.Nil {
		return Job{}, apperr.New(apperr.KindInvalidArgument, "administrator id is required")
	}
	if input.ResourceID == uuid.Nil {
		return Job{}, apperr.New(apperr.KindInvalidArgument, "resource_id is required")
	}
	if _, _, err := resolveAction(input.ResourceType, input.ExportType); err != nil {
		return Job{}, err
	}
	if input.ResourceType == "dataset" {
		return Job{}, apperr.New(apperr.KindInvalidArgument, "select a device or data stream for an operations export")
	}
	deviceID := input.ResourceID
	if input.ResourceType == "data_stream" || input.ResourceType == "media" {
		stream, err := s.queries.GetDataStream(ctx, input.ResourceID)
		if err != nil {
			return Job{}, mapNotFoundOrInternal(err, "data stream not found")
		}
		deviceID = stream.DeviceID
	}
	asset, err := s.queries.GetDevice(ctx, deviceID)
	if err != nil {
		return Job{}, mapNotFoundOrInternal(err, "device not found")
	}
	cfg, err := normalizeRequestConfig(input.RequestConfig)
	if err != nil {
		return Job{}, err
	}
	switch input.ExportType {
	case "standard_station_zip", "group_site_zip":
		err = s.validateDeviceBatch(ctx, uuid.Nil, uuid.Nil, input.ResourceID, input.ExportType, cfg, true)
	case "carbon_station_zip":
		if asset.DeviceType != "carbon_sink" {
			return Job{}, apperr.New(apperr.KindInvalidArgument, "carbon export requires a carbon sink device")
		}
		err = validateCarbonStationConfig(cfg)
	default:
		_, err = parseRequestConfig(cfg, s.cfg.MaxRows)
	}
	if err != nil {
		return Job{}, err
	}
	cfg, err = s.snapshotNodeNames(ctx, input.ResourceType, input.ResourceID, cfg)
	if err != nil {
		return Job{}, err
	}
	expiry := time.Now().UTC().Add(time.Duration(s.cfg.FileTTLHours) * time.Hour)
	row, err := s.queries.CreateAdminExportJob(ctx, sqlc.CreateAdminExportJobParams{RequestedByAdmin: &adminID, ResourceType: input.ResourceType, ResourceID: input.ResourceID, ExportType: input.ExportType, RequestConfigJson: cfg, ExpiresAt: pgTime(expiry)})
	if err != nil {
		return Job{}, mapWriteError(err, "create administrator export")
	}
	return jobFromSQL(row), nil
}

func adminActor(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok || !actor.IsSystemAdmin {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator session required"))
		return auth.Actor{}, false
	}
	return actor, true
}

func (h *Handler) AdminList(c *gin.Context) {
	if _, ok := adminActor(c); !ok {
		return
	}
	deviceID, provided, ok := parseOptionalUUIDValue(c.Query("device_id"), "device_id", c)
	if !ok {
		return
	}
	var filter *uuid.UUID
	if provided {
		filter = &deviceID
	}
	rows, err := h.service.queries.ListAdminExportJobs(c.Request.Context(), sqlc.ListAdminExportJobsParams{DeviceID: filter, MaxJobs: audit.ParseLimit(c.Query("limit"))})
	if err != nil {
		httpx.WriteAppError(c, apperr.Wrap(apperr.KindInternal, "list administrator exports", err))
		return
	}
	items := make([]Job, 0, len(rows))
	for _, row := range rows {
		items = append(items, jobFromSQL(row))
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *Handler) AdminCreate(c *gin.Context) {
	actor, ok := adminActor(c)
	if !ok {
		return
	}
	var req createExportJobRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid request body"))
		return
	}
	id, ok := parseUUIDValue(req.ResourceID, "resource_id", c)
	if !ok {
		return
	}
	cfg, ok := buildRequestConfig(req.ExportType, req.RequestConfig, req.StartTime, req.EndTime, req.Limit, c)
	if !ok {
		return
	}
	job, err := h.service.CreateAdmin(c.Request.Context(), actor.UserID, CreateInput{ResourceType: req.ResourceType, ResourceID: id, ExportType: req.ExportType, RequestConfig: cfg})
	if err != nil {
		if !h.record(c, audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "admin.export.create", ResourceType: "device", ResourceID: audit.ResourceID(id), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)})) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "admin.export.create", ResourceType: "export_job", ResourceID: audit.ResourceID(job.ID), Result: audit.ResultSuccess})) {
		reason := "审计记录写入失败，导出任务未启动"
		_, _ = h.service.queries.MarkExportJobFailed(c.Request.Context(), sqlc.MarkExportJobFailedParams{ID: job.ID, ErrorMessage: &reason})
		return
	}
	if h.enqueuer != nil {
		// A failed queue publish leaves a pending job for the normal reconciler.
		if err := h.enqueuer.EnqueueExportJob(c.Request.Context(), job.ID); err != nil {
			if h.audit != nil {
				_, _ = h.audit.Record(c.Request.Context(), audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "admin.export.queue_deferred", ResourceType: "export_job", ResourceID: audit.ResourceID(job.ID), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)}))
			}
			c.JSON(http.StatusAccepted, job)
			return
		}
	}
	c.JSON(http.StatusCreated, job)
}

func (h *Handler) AdminGet(c *gin.Context) {
	if _, ok := adminActor(c); !ok {
		return
	}
	id, ok := parseUUIDParam(c, "export_job_id")
	if !ok {
		return
	}
	job, err := h.service.Get(c.Request.Context(), id)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *Handler) AdminDownload(c *gin.Context) {
	actor, ok := adminActor(c)
	if !ok {
		return
	}
	id, ok := parseUUIDParam(c, "export_job_id")
	if !ok {
		return
	}
	result, err := h.service.prepareDownload(c.Request.Context(), id, nil, uuid.Nil, "admin_export")
	if err != nil {
		if !h.record(c, audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "admin.export.download", ResourceType: "export_job", ResourceID: audit.ResourceID(id), Result: audit.ResultFailure, Reason: apperr.MessageOf(err)})) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.FromRequest(c, audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorID: audit.UserActorID(actor.UserID), Action: "admin.export.download", ResourceType: "export_job", ResourceID: audit.ResourceID(id), Result: audit.ResultSuccess})) {
		return
	}
	c.JSON(http.StatusOK, result)
}
