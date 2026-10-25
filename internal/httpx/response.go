package httpx

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
)

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"request_id,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

func WriteError(c *gin.Context, status int, code string, message string) {
	c.JSON(status, ErrorEnvelope{
		Error: ErrorBody{
			Code:      code,
			Message:   message,
			RequestID: RequestIDFromContext(c),
		},
	})
}

func WriteAppError(c *gin.Context, err error) {
	kind := apperr.KindOf(err)
	status := http.StatusInternalServerError

	switch kind {
	case apperr.KindInvalidArgument:
		status = http.StatusBadRequest
	case apperr.KindUnauthorized:
		status = http.StatusUnauthorized
	case apperr.KindPermissionDenied:
		status = http.StatusForbidden
	case apperr.KindNotFound:
		status = http.StatusNotFound
	case apperr.KindConflict:
		status = http.StatusConflict
	case apperr.KindRateLimited:
		status = http.StatusTooManyRequests
	case apperr.KindDataSource:
		status = http.StatusBadGateway
	}

	details := apperr.DetailsOf(err)
	if seconds, ok := details["retry_after_seconds"].(int); ok && seconds > 0 {
		c.Header("Retry-After", strconv.Itoa(seconds))
	}
	message := apperr.MessageOf(err)
	if status >= 500 {
		message = "service temporarily unavailable"
	}
	c.JSON(status, ErrorEnvelope{Error: ErrorBody{Code: string(kind), Message: message, RequestID: RequestIDFromContext(c), Details: details}})
}
