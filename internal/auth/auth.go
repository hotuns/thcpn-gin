package auth

import (
	"context"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/httpx"
)

const HeaderUserID = "X-User-ID"

const actorContextKey = "actor"

type MiddlewareConfig struct {
	TokenManager         *TokenManager
	RevocationChecker    TokenRevocationChecker
	DevUserHeaderEnabled bool
}

type Actor struct {
	UserID          uuid.UUID  `json:"id"`
	Name            string     `json:"name"`
	Phone           *string    `json:"phone,omitempty"`
	Email           *string    `json:"email,omitempty"`
	Status          string     `json:"status"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
}

type ActorLookup interface {
	LookupActor(ctx context.Context, id uuid.UUID) (Actor, error)
}

type TokenRevocationChecker interface {
	IsAccessTokenRevoked(ctx context.Context, rawToken string) (bool, error)
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
		return authenticateBearer(c.Request.Context(), authHeader, cfg)
	}

	if cfg.DevUserHeaderEnabled {
		return authenticateDevUserHeader(c.GetHeader(HeaderUserID))
	}

	return uuid.Nil, apperr.New(apperr.KindUnauthorized, "missing bearer token")
}

func BearerTokenFromHeader(header string) (string, error) {
	parts := strings.Fields(strings.TrimSpace(header))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	return parts[1], nil
}

func authenticateBearer(ctx context.Context, header string, cfg MiddlewareConfig) (uuid.UUID, error) {
	if cfg.TokenManager == nil {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "token authentication is not configured")
	}
	rawToken, err := BearerTokenFromHeader(header)
	if err != nil {
		return uuid.Nil, err
	}
	userID, err := cfg.TokenManager.Parse(rawToken)
	if err != nil {
		return uuid.Nil, apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	if cfg.RevocationChecker != nil {
		revoked, err := cfg.RevocationChecker.IsAccessTokenRevoked(ctx, rawToken)
		if err != nil {
			return uuid.Nil, err
		}
		if revoked {
			return uuid.Nil, apperr.New(apperr.KindUnauthorized, "access token has been revoked")
		}
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
