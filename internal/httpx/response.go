package httpx

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
)

type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
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
	}

	WriteError(c, status, string(kind), apperr.MessageOf(err))
}
