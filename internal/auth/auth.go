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
	IsSystemAdmin   bool       `json:"is_system_admin"`
	PhoneVerifiedAt *time.Time `json:"phone_verified_at,omitempty"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	AuthVersion     int        `json:"-"`
}

// IsSystemAdministrator lets cross-cutting concerns identify the separate
// system administrator identity without importing the auth package back into
// those packages.
func (a Actor) IsSystemAdministrator() bool { return a.IsSystemAdmin }

func (a Actor) SystemAdministratorID() uuid.UUID {
	if !a.IsSystemAdmin {
		return uuid.Nil
	}
	return a.UserID
}

func (a Actor) LogActorType() string {
	if a.IsSystemAdmin {
		return "system_admin"
	}
	return "user"
}
func (a Actor) LogActorID() string   { return a.UserID.String() }
func (a Actor) LogActorName() string { return a.Name }

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
		credentials, err := authenticateRequest(c, cfg)
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

		actor, err := lookup.LookupActor(c.Request.Context(), credentials.UserID)
		if err != nil {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "user is not active"))
			c.Abort()
			return
		}
		if credentials.AuthVersion >= 0 && actor.AuthVersion != credentials.AuthVersion {
			httpx.WriteAppError(c, apperr.New(apperr.KindUnauthorized, "access token has been invalidated"))
			c.Abort()
			return
		}

		c.Set(actorContextKey, actor)
		c.Next()
	}
}

type authenticationResult struct {
	UserID      uuid.UUID
	AuthVersion int
}

func authenticateRequest(c *gin.Context, cfg MiddlewareConfig) (authenticationResult, error) {
	authHeader := strings.TrimSpace(c.GetHeader("Authorization"))
	if authHeader != "" {
		return authenticateBearer(c.Request.Context(), authHeader, cfg)
	}

	if cfg.DevUserHeaderEnabled {
		userID, err := authenticateDevUserHeader(c.GetHeader(HeaderUserID))
		return authenticationResult{UserID: userID, AuthVersion: -1}, err
	}

	return authenticationResult{}, apperr.New(apperr.KindUnauthorized, "missing bearer token")
}

func BearerTokenFromHeader(header string) (string, error) {
	parts := strings.Fields(strings.TrimSpace(header))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	return parts[1], nil
}

func authenticateBearer(ctx context.Context, header string, cfg MiddlewareConfig) (authenticationResult, error) {
	if cfg.TokenManager == nil {
		return authenticationResult{}, apperr.New(apperr.KindUnauthorized, "token authentication is not configured")
	}
	rawToken, err := BearerTokenFromHeader(header)
	if err != nil {
		return authenticationResult{}, err
	}
	info, err := cfg.TokenManager.ParseInfo(rawToken)
	if err != nil {
		return authenticationResult{}, apperr.New(apperr.KindUnauthorized, "invalid bearer token")
	}
	if cfg.RevocationChecker != nil {
		revoked, err := cfg.RevocationChecker.IsAccessTokenRevoked(ctx, rawToken)
		if err != nil {
			return authenticationResult{}, err
		}
		if revoked {
			return authenticationResult{}, apperr.New(apperr.KindUnauthorized, "access token has been revoked")
		}
	}
	return authenticationResult{UserID: info.UserID, AuthVersion: info.AuthVersion}, nil
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

func SetActorContext(c *gin.Context, actor Actor) {
	c.Set(actorContextKey, actor)
}
