package adminauth

import (
	"github.com/gin-gonic/gin"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/httpx"
)

func Middleware(tokens *auth.TokenManager, service *Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw, err := auth.BearerTokenFromHeader(c.GetHeader("Authorization"))
		if err != nil {
			httpx.WriteAppError(c, err)
			c.Abort()
			return
		}
		id, err := tokens.Parse(raw)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "invalid administrator access token"))
			c.Abort()
			return
		}
		actor, err := service.LookupActor(c.Request.Context(), id.String())
		if err != nil {
			httpx.WriteAppError(c, err)
			c.Abort()
			return
		}
		auth.SetActorContext(c, actor)
		c.Next()
	}
}

func ActorFromContext(c *gin.Context) (auth.Actor, bool) { return auth.ActorFromContext(c) }
