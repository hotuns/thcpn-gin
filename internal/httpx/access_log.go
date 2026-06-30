package httpx

import (
	"io"
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
)

func AccessLog(log *slog.Logger) gin.HandlerFunc {
	if log == nil {
		log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}

	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		attrs := []slog.Attr{
			slog.String("request_id", RequestIDFromContext(c)),
			slog.String("method", c.Request.Method),
			slog.String("path", c.FullPath()),
			slog.Int("status", c.Writer.Status()),
			slog.Int("bytes", c.Writer.Size()),
			slog.Int64("duration_ms", time.Since(start).Milliseconds()),
			slog.String("client_ip", c.ClientIP()),
		}
		if len(c.Errors) > 0 {
			attrs = append(attrs, slog.String("error", c.Errors.String()))
		}

		log.LogAttrs(c.Request.Context(), slog.LevelInfo, "http_request", attrs...)
	}
}
