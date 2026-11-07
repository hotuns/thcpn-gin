package app

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"thcpn-gin/internal/adminauth"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/httpx"
	"thcpn-gin/internal/systemsettings"
)

func settingsMiddleware(service *systemsettings.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, err := service.Context(c.Request.Context())
		if err != nil {
			httpx.WriteAppError(c, err)
			c.Abort()
			return
		}
		c.Request = c.Request.WithContext(ctx)
		c.Next()
	}
}
func registerSystemSettings(api, admin *gin.RouterGroup, service *systemsettings.Service, auditService *audit.Service) {
	// Only public product constraints and the public site address are exposed.
	api.GET("/system/policy", func(c *gin.Context) {
		snapshot, err := service.Load(c.Request.Context())
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, systemsettings.Public(snapshot))
	})
	admin.GET("/settings", func(c *gin.Context) {
		snapshot, err := service.Load(c.Request.Context())
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusOK, snapshot)
	})
	admin.GET("/settings/history", func(c *gin.Context) {
		items, err := service.History(c.Request.Context())
		if err != nil {
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	})
	admin.PUT("/settings", func(c *gin.Context) {
		actor, ok := adminauth.ActorFromContext(c)
		if !ok {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "administrator required"))
			return
		}
		var input systemsettings.UpdateInput
		if err := c.ShouldBindJSON(&input); err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindInvalidArgument, "业务参数必须为整数，平台访问地址必须为字符串，并填写修改原因"))
			return
		}
		snapshot, err := service.Update(c.Request.Context(), input, systemsettings.Actor{ID: actor.UserID, IP: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: httpx.RequestIDFromContext(c)})
		if err != nil {
			_, auditErr := auditService.Record(c.Request.Context(), audit.RecordInput{ActorType: audit.ActorSystemAdmin, ActorAdminID: &actor.UserID, Action: "system.settings.update", ResourceType: "system_settings", Result: audit.ResultFailure, Reason: apperr.MessageOf(err), IP: c.ClientIP(), UserAgent: c.Request.UserAgent(), RequestID: httpx.RequestIDFromContext(c)})
			if auditErr != nil {
				httpx.WriteAppError(c, auditErr)
				return
			}
			httpx.WriteAppError(c, err)
			return
		}
		c.JSON(http.StatusOK, snapshot)
	})
}
