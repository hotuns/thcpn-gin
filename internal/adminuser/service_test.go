package adminuser

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestAdminUserValidatesPublicInputs(t *testing.T) {
	service := NewService(nil, config.PasswordConfig{})
	if _, err := service.Get(t.Context(), uuid.Nil); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected get validation error, got %v", err)
	}
	if _, _, err := service.Create(t.Context(), CreateInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected create validation error, got %v", err)
	}
	if _, err := service.Update(t.Context(), uuid.Nil, UpdateInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected update validation error, got %v", err)
	}
	if err := service.UpdateStatus(t.Context(), uuid.New(), "pending"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected status validation error, got %v", err)
	}
}
