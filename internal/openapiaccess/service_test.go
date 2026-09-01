package openapiaccess

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestAPIKeyInputValidation(t *testing.T) {
	service := NewService(nil, nil)
	if _, err := service.Create(t.Context(), uuid.New(), uuid.New(), "", nil); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected key name validation error, got %v", err)
	}
	past := time.Now().Add(-time.Minute)
	if _, err := service.Create(t.Context(), uuid.New(), uuid.New(), "integration", &past); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected expiration validation error, got %v", err)
	}
	if _, err := service.Authenticate(t.Context(), "invalid"); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected authentication validation error, got %v", err)
	}
}
