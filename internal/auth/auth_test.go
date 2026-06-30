package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

type fakeActorLookup struct {
	actor Actor
	err   error
}

func (f fakeActorLookup) LookupActor(context.Context, uuid.UUID) (Actor, error) {
	if f.err != nil {
		return Actor{}, f.err
	}
	return f.actor, nil
}

func TestMiddlewareRequiresUserIDHeader(t *testing.T) {
	status := runMiddlewareTest(t, "", fakeActorLookup{})
	if status != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", status)
	}
}

func TestMiddlewareRejectsInvalidUserIDHeader(t *testing.T) {
	status := runMiddlewareTest(t, "not-a-uuid", fakeActorLookup{})
	if status != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", status)
	}
}

func TestMiddlewareRejectsInactiveUser(t *testing.T) {
	status := runMiddlewareTest(t, uuid.NewString(), fakeActorLookup{
		err: apperr.New(apperr.KindNotFound, "user not found"),
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", status)
	}
}

func TestMiddlewareSetsActor(t *testing.T) {
	userID := uuid.New()
	status := runMiddlewareTest(t, userID.String(), fakeActorLookup{
		actor: Actor{UserID: userID, Name: "tester", Status: "active"},
	})
	if status != http.StatusOK {
		t.Fatalf("expected ok, got %d", status)
	}
}

func TestMiddlewareAcceptsBearerToken(t *testing.T) {
	userID := uuid.New()
	tokens := NewTokenManager("test-secret", time.Hour)
	token, err := tokens.Generate(userID)
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}

	status := runMiddlewareRequest(t, middlewareTestRequest{
		authorization: "Bearer " + token.AccessToken,
		useConfig:     true,
		config: MiddlewareConfig{
			TokenManager:         tokens,
			DevUserHeaderEnabled: false,
		},
		lookup: fakeActorLookup{
			actor: Actor{UserID: userID, Name: "tester", Status: "active"},
		},
	})
	if status != http.StatusOK {
		t.Fatalf("expected ok, got %d", status)
	}
}

func TestMiddlewareRequiresBearerWhenDevHeaderDisabled(t *testing.T) {
	status := runMiddlewareRequest(t, middlewareTestRequest{
		useConfig: true,
		config:    MiddlewareConfig{DevUserHeaderEnabled: false},
		lookup:    fakeActorLookup{},
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", status)
	}
}

func TestMiddlewareRejectsInvalidBearerEvenWithDevHeader(t *testing.T) {
	status := runMiddlewareRequest(t, middlewareTestRequest{
		authorization: "Bearer invalid",
		userIDHeader:  uuid.NewString(),
		useConfig:     true,
		config: MiddlewareConfig{
			TokenManager:         NewTokenManager("test-secret", time.Hour),
			DevUserHeaderEnabled: true,
		},
		lookup: fakeActorLookup{},
	})
	if status != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized, got %d", status)
	}
}

func runMiddlewareTest(t *testing.T, header string, lookup ActorLookup) int {
	t.Helper()
	return runMiddlewareRequest(t, middlewareTestRequest{
		userIDHeader: header,
		lookup:       lookup,
	})
}

type middlewareTestRequest struct {
	authorization string
	userIDHeader  string
	useConfig     bool
	config        MiddlewareConfig
	lookup        ActorLookup
}

func runMiddlewareRequest(t *testing.T, input middlewareTestRequest) int {
	t.Helper()

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	if input.useConfig {
		router.Use(Middleware(input.lookup, input.config))
	} else {
		router.Use(Middleware(input.lookup))
	}
	router.GET("/protected", func(c *gin.Context) {
		if _, ok := ActorFromContext(c); !ok {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if input.authorization != "" {
		req.Header.Set("Authorization", input.authorization)
	}
	if input.userIDHeader != "" {
		req.Header.Set(HeaderUserID, input.userIDHeader)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec.Code
}
