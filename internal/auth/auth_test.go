package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

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

func runMiddlewareTest(t *testing.T, header string, lookup ActorLookup) int {
	t.Helper()

	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(Middleware(lookup))
	router.GET("/protected", func(c *gin.Context) {
		if _, ok := ActorFromContext(c); !ok {
			c.Status(http.StatusInternalServerError)
			return
		}
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/protected", nil)
	if header != "" {
		req.Header.Set(HeaderUserID, header)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec.Code
}
