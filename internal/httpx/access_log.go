package httpx

import (
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel/trace"
)

type logActor interface {
	LogActorType() string
	LogActorID() string
	LogActorName() string
}

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
		if value, ok := c.Get("actor"); ok {
			if actor, ok := value.(logActor); ok {
				attrs = append(attrs, slog.String("actor_type", actor.LogActorType()), slog.String("actor_id", actor.LogActorID()), slog.String("actor_name", actor.LogActorName()))
			}
		} else {
			attrs = append(attrs, slog.String("actor_type", "anonymous"))
		}
		if workspaceID, ok := c.Get("log_workspace_id"); ok {
			attrs = append(attrs, slog.String("workspace_id", strings.TrimSpace(fmt.Sprint(workspaceID))))
		} else if workspaceID := strings.TrimSpace(c.Param("workspace_id")); workspaceID != "" {
			attrs = append(attrs, slog.String("workspace_id", workspaceID))
		} else if workspaceID := strings.TrimSpace(c.Query("workspace_id")); workspaceID != "" {
			attrs = append(attrs, slog.String("workspace_id", workspaceID))
		}
		if spanContext := trace.SpanContextFromContext(c.Request.Context()); spanContext.IsValid() {
			attrs = append(attrs, slog.String("trace_id", spanContext.TraceID().String()))
		}
		if len(c.Errors) > 0 {
			attrs = append(attrs, slog.String("error", c.Errors.String()))
		}

		log.LogAttrs(c.Request.Context(), slog.LevelInfo, "http_request", attrs...)
	}
}
