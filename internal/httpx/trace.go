package httpx

import (
	"strings"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"

	"thcpn-gin/internal/tracing"
)

func Trace(serviceName string, excludedPaths ...string) gin.HandlerFunc {
	serviceName = strings.TrimSpace(serviceName)
	excluded := make(map[string]struct{}, len(excludedPaths))
	for _, path := range excludedPaths {
		path = strings.TrimSpace(path)
		if path != "" {
			excluded[path] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		if _, ok := excluded[c.Request.URL.Path]; ok {
			c.Next()
			return
		}

		ctx := otel.GetTextMapPropagator().Extract(
			c.Request.Context(),
			propagation.HeaderCarrier(c.Request.Header),
		)
		attrs := []attribute.KeyValue{
			attribute.String("http.method", c.Request.Method),
			attribute.String("http.path", c.Request.URL.Path),
			attribute.String("http.client_ip", c.ClientIP()),
			attribute.String("http.user_agent", c.Request.UserAgent()),
		}
		if serviceName != "" {
			attrs = append(attrs, attribute.String("service.name", serviceName))
		}

		ctx, span := tracing.Start(ctx, c.Request.Method+" "+c.Request.URL.Path, attrs...)
		c.Request = c.Request.WithContext(ctx)
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "unmatched"
		}
		span.SetName(c.Request.Method + " " + route)
		span.SetAttributes(
			attribute.String("http.route", route),
			attribute.Int("http.status_code", c.Writer.Status()),
		)
		for _, ginErr := range c.Errors {
			if ginErr.Err != nil {
				span.RecordError(ginErr.Err)
			}
		}
		if c.Writer.Status() >= 500 {
			span.SetStatus(codes.Error, "server error")
		}
		span.End()
	}
}
