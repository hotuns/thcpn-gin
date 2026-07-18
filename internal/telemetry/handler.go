package telemetry

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/permission"
)

const telemetryHistoryAction = "telemetry.view_history"

type Handler struct {
	service *Service
	checker *permission.Checker
}

func NewHandler(service *Service, checker *permission.Checker) *Handler {
	return &Handler{service: service, checker: checker}
}

func (h *Handler) QueryDevice(c *gin.Context) {
	deviceID, ok := parseUUIDParam(c, "device_id")
	if !ok {
		return
	}
	if !h.authorize(c, "device", deviceID, telemetryHistoryAction) {
		return
	}

	input, ok := parseQuery(c)
	if !ok {
		return
	}
	input.DeviceID = &deviceID

	result, err := h.service.Query(c.Request.Context(), input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) QueryDataStream(c *gin.Context) {
	dataStreamID, ok := parseUUIDParam(c, "data_stream_id")
	if !ok {
		return
	}
	if !h.authorize(c, "data_stream", dataStreamID, telemetryHistoryAction) {
		return
	}

	input, ok := parseQuery(c)
	if !ok {
		return
	}
	input.DataStreamID = &dataStreamID

	result, err := h.service.Query(c.Request.Context(), input)
	if err != nil {
		httpx.WriteAppError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

func parseQuery(c *gin.Context) (QueryInput, bool) {
	start, ok := parseTimeQuery(c, "start_time")
	if !ok {
		return QueryInput{}, false
	}
	end, ok := parseTimeQuery(c, "end_time")
	if !ok {
		return QueryInput{}, false
	}
	limit, ok := parseOptionalIntQuery(c, "limit")
	if !ok {
		return QueryInput{}, false
	}
	adaptive, ok := parseOptionalBoolQuery(c, "adaptive")
	if !ok {
		return QueryInput{}, false
	}
	targetPoints, ok := parseOptionalIntQuery(c, "target_points")
	if !ok {
		return QueryInput{}, false
	}
	return QueryInput{
		StartTime:    start,
		EndTime:      end,
		Limit:        limit,
		Adaptive:     adaptive,
		TargetPoints: targetPoints,
	}, true
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

func parseOptionalBoolQuery(c *gin.Context, name string) (bool, bool) {
	value := c.Query(name)
	if value == "" {
		return false, true
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "invalid "+name))
		return false, false
	}
	return parsed, true
}

func (h *Handler) authorize(c *gin.Context, resourceType string, resourceID uuid.UUID, action string) bool {
	actor, ok := actorFromContext(c)
	if !ok {
		return false
	}
	if h.checker == nil {
		httpx.WriteAppError(c, apperr.New(apperr.KindInternal, "permission checker is not configured"))
		return false
	}

	decision, err := h.checker.Can(c.Request.Context(), permission.Actor{UserID: actor.UserID}, action, permission.ResourceRef{
		Type: resourceType,
		ID:   resourceID,
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
