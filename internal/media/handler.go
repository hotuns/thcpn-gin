package media

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const (
	mediaArchiveViewAction = "media.archive_view"
	mediaDownloadAction    = "media.download"
	mediaDeleteAction      = "media.delete"
)

type Handler struct {
	service *Service
	checker *permission.Checker
	audit   *audit.Service
}

func NewHandler(service *Service, checker *permission.Checker, auditServices ...*audit.Service) *Handler {
	var auditService *audit.Service
	if len(auditServices) > 0 {
		auditService = auditServices[0]
	}
	return &Handler{service: service, checker: checker, audit: auditService}
}

func (h *Handler) ListDevice(c *gin.Context) {
	h.listDevice(c, "")
}

func (h *Handler) ListDeviceImages(c *gin.Context) {
	h.listDevice(c, "image")
}

func (h *Handler) ListDeviceVideos(c *gin.Context) {
	h.listDevice(c, "video")
}

func (h *Handler) listDevice(c *gin.Context, mediaType string) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if mediaType == "" {
		mediaType = c.Query("media_type")
	}
	if !h.authorize(c, "device", deviceID, mediaArchiveViewAction) {
		return
	}
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	downloadAllowed, ok := h.can(c, "device", deviceID, mediaDownloadAction)
	if !ok {
		return
	}
	deleteAllowed, ok := h.can(c, "device", deviceID, mediaDeleteAction)
	if !ok {
		return
	}

	input, ok := parseListQuery(c)
	if !ok {
		return
	}
	input.DeviceID = &deviceID
	input.MediaType = mediaType
	input.DownloadAllowed = downloadAllowed
	input.DeleteAllowed = deleteAllowed
	input.AllowUnassigned = actor.IsDemo

	result, err := h.service.List(c.Request.Context(), input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) ListDataStream(c *gin.Context) {
	dataStreamID, ok := parseUUIDParam(c, "data_stream_id")
	if !ok {
		return
	}
	if !h.authorize(c, "data_stream", dataStreamID, mediaArchiveViewAction) {
		return
	}
	downloadAllowed, ok := h.can(c, "data_stream", dataStreamID, mediaDownloadAction)
	if !ok {
		return
	}
	deleteAllowed, ok := h.can(c, "data_stream", dataStreamID, mediaDeleteAction)
	if !ok {
		return
	}

	input, ok := parseListQuery(c)
	if !ok {
		return
	}
	input.DataStreamID = &dataStreamID
	input.DownloadAllowed = downloadAllowed
	input.DeleteAllowed = deleteAllowed

	result, err := h.service.List(c.Request.Context(), input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) Download(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	token := c.Query("token")
	if token == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "token is required"))
		return
	}

	result, err := h.service.PrepareDownload(c.Request.Context(), token, actor.UserID)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	allowed, err := h.check(c, "data_stream", result.DataStreamID, mediaDownloadAction)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !allowed {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       mediaDownloadAction,
			ResourceType: "data_stream",
			ResourceID:   audit.ResourceID(result.DataStreamID),
			Result:       audit.ResultFailure,
			Reason:       "permission denied",
		}) {
			return
		}
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       mediaDownloadAction,
		ResourceType: "data_stream",
		ResourceID:   audit.ResourceID(result.DataStreamID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Handler) Delete(c *gin.Context) {
	actor, ok := actorFromContext(c)
	if !ok {
		return
	}
	token := c.Query("token")
	if token == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "token is required"))
		return
	}

	target, err := h.service.ResolveMediaToken(c.Request.Context(), token)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}

	allowed, err := h.check(c, "data_stream", target.DataStreamID, mediaDeleteAction)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	if !allowed {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(target.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       mediaDeleteAction,
			ResourceType: "data_stream",
			ResourceID:   audit.ResourceID(target.DataStreamID),
			Result:       audit.ResultFailure,
			Reason:       "permission denied",
		}) {
			return
		}
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return
	}

	result, err := h.service.DeleteMediaObject(c.Request.Context(), target)
	if err != nil {
		if !h.record(c, audit.RecordInput{
			WorkspaceID:  audit.WorkspaceID(target.WorkspaceID),
			ActorType:    audit.ActorUser,
			ActorID:      audit.UserActorID(actor.UserID),
			Action:       mediaDeleteAction,
			ResourceType: "data_stream",
			ResourceID:   audit.ResourceID(target.DataStreamID),
			Result:       audit.ResultFailure,
			Reason:       apperr.MessageOf(err),
		}) {
			return
		}
		httpx.WriteAppError(c, err)
		return
	}
	if !h.record(c, audit.RecordInput{
		WorkspaceID:  audit.WorkspaceID(result.WorkspaceID),
		ActorType:    audit.ActorUser,
		ActorID:      audit.UserActorID(actor.UserID),
		Action:       mediaDeleteAction,
		ResourceType: "data_stream",
		ResourceID:   audit.ResourceID(result.DataStreamID),
		Result:       audit.ResultSuccess,
	}) {
		return
	}

	c.JSON(http.StatusOK, result)
}

func parseListQuery(c *gin.Context) (QueryInput, bool) {
	start, ok := parseTimeQuery(c, "start_time")
	if !ok {
		return QueryInput{}, false
	}
	end, ok := parseTimeQuery(c, "end_time")
	if !ok {
		return QueryInput{}, false
	}
	page, ok := parseOptionalIntQuery(c, "page")
	if !ok {
		return QueryInput{}, false
	}
	pageSize, ok := parseOptionalIntQuery(c, "page_size")
	if !ok {
		return QueryInput{}, false
	}
	return QueryInput{StartTime: start, EndTime: end, Page: page, PageSize: pageSize}, true
}

func parseTimeQuery(c *gin.Context, name string) (time.Time, bool) {
	value := c.Query(name)
	if value == "" {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, name+" is required"))
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return time.Time{}, false
	}
	return parsed, true
}

func parseOptionalIntQuery(c *gin.Context, name string) (int, bool) {
	value := c.Query(name)
	if value == "" {
		return 0, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return 0, false
	}
	return parsed, true
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	allowed, err := h.check(c, resourceType, resourceID, action)
	if err != nil {
		httpx.WriteAppError(c, err)
		return false
	}
	if !allowed {
		httpx.WriteAppError(c, apperr.New(apperr.KindPermissionDenied, "permission denied"))
		return false
	}
	return true
}

func (h *Handler) can(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) (bool, bool) {
	allowed, err := h.check(c, resourceType, resourceID, action)
	if err != nil {
		httpx.WriteAppError(c, err)
		return false, false
	}
	return allowed, true
}

func (h *Handler) check(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) (bool, error) {
	actor, ok := actorFromContext(c)
	if !ok {
		return false, apperr.New(apperr.KindUnauthorized, "missing authenticated user")
	}
	if h.checker == nil {
		return false, apperr.New(apperr.KindInternal, "permission checker is not configured")
	}
	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
	})
	if err != nil {
		return false, err
	}
	return decision.Allowed, nil
}

func actorFromContext(c *gin.Context) (auth.Actor, bool) {
	actor, ok := auth.ActorFromContext(c)
	if !ok {
		httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing authenticated user"))
		return auth.Actor{}, false
	}
	return actor, true
}

func parseUUIDParam(c *gin.Context, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(c.Param(name))
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return uuid.Nil, false
	}
	return id, true
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
