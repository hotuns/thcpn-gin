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

type MiddlewareConfig struct {
	TokenManager         *TokenManager
	DevUserHeaderEnabled bool
}

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

func Middleware(lookup ActorLookup, configs ...MiddlewareConfig) gin.HandlerFunc {
	cfg := MiddlewareConfig{
		DevUserHeaderEnabled: true,
	}
	if len(configs) > 0 {
		cfg = configs[0]
	}

	return func(c *gin.Context) {
		userID, err := authenticateRequest(c, cfg)
		if err != nil {
			httpx.WriteAppError(c, err)
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

func authenticateRequest(c *gin.Context, cfg MiddlewareConfig) (uuid.UUID, error) {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if authHeader != "" {
		return authenticateBearer(authHeader, cfg.TokenManager)
	}

	if cfg.DevUserHeaderEnabled {
		return authenticateDevUserHeader(c.GetHeader(HeaderUserID))
	}

	return uuid.Nil, apperr.New(apperr.KindUnauthorized, "missing bearer token")
}

func authenticateBearer(header string, tokens *TokenManager) (uuid.UUID, error) {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	if tokens == nil {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "token authentication is not configured")
	}

	userID, err := tokens.Parse(parts[1])
	if err != nil {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	return userID, nil
}

func authenticateDevUserHeader(rawUserID string) (uuid.UUID, error) {
	rawUserID = strings.TrimSpace(rawUserID)
	if rawUserID == "" {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "missing bearer token or X-User-ID header")
	}

	userID, err := uuid.Parse(rawUserID)
	if err != nil {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "invalid X-User-ID header")
	}
	return userID, nil
}

func ActorFromContext(c *gin.Context) (Actor, bool) {
	value, ok := c.Get(actorContextKey)
	if !ok {
		return Actor{}, false
	}

	actor, ok := value.(Actor)
	return actor, ok
}
