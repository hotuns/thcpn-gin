package auth

import (
	"context"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

const HeaderUserID = "X-User-ID"

const actorContextKey = "actor"

type Actor struct {
	UserID uuid.UUID `json:"id"`
	Name   string    `json:"name"`
	Phone  *string   `json:"phone,omitempty"`
	Email  *string   `json:"email,omitempty"`
	Status string    `json:"status"`
}

type ActorLookup interface {
	LookupActor(ctx context.Context, id uuid.UUID) (Actor, error)
}

func Middleware(lookup ActorLookup) gin.HandlerFunc {
	return func(c *gin.Context) {
		rawUserID := strings.TrimSpace(c.GetHeader(HeaderUserID))
		if rawUserID == "" {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "missing X-User-ID header"))
			c.Abort()
			return
		}

		userID, err := uuid.Parse(rawUserID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "invalid X-User-ID header"))
			c.Abort()
			return
		}

		if lookup == nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "authentication is not configured"))
			c.Abort()
			return
		}

		actor, err := lookup.LookupActor(c.Request.Context(), userID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "user is not active"))
			c.Abort()
			return
		}

		c.Set(actorContextKey, actor)
		c.Next()
	}
}

func ActorFromContext(c *gin.Context) (Actor, bool) {
	value, ok := c.Get(actorContextKey)
	if !ok {
		return Actor{}, false
	}

	actor, ok := value.(Actor)
	return actor, ok
}
