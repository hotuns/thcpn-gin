package adminauth

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestAdminAuthenticationValidatesInputs(t *testing.T) {
	service := NewService(nil, nil, time.Minute, time.Hour, config.PasswordConfig{})
	if _, err := service.Login(t.Context(), LoginInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected login validation error, got %v", err)
	}
	if _, err := service.Refresh(t.Context(), "", "", ""); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected refresh validation error, got %v", err)
	}
	if _, err := service.LookupActor(t.Context(), "not-a-uuid"); apperr.KindOf(err) != apperr.KindUnauthorized {
		t.Fatalf("expected actor validation error, got %v", err)
	}
	if err := service.ChangePassword(t.Context(), uuid.New(), "", "new-password"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected password validation error, got %v", err)
	}
	if err := service.Logout(t.Context(), ""); err != nil {
		t.Fatalf("empty logout token should be idempotent: %v", err)
	}
}
