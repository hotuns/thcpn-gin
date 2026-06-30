package httpx

import (
	"time"

	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/metrics"
)

func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		path := c.FullPath()
		if path == "" {
			path = "unmatched"
		}
		metrics.ObserveHTTPRequest(c.Request.Method, path, c.Writer.Status(), time.Since(start))
	}
}
