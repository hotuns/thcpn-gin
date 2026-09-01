package systemadmin

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestSystemAdministratorValidation(t *testing.T) {
	service := NewService(nil)
	if _, _, err := service.Create(t.Context(), "", "", ""); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected create validation error, got %v", err)
	}
	if err := service.SetStatus(t.Context(), uuid.New(), uuid.New(), "pending"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected status validation error, got %v", err)
	}
	id := uuid.New()
	if err := service.SetStatus(t.Context(), id, id, "disabled"); apperr.KindOf(err) != apperr.KindConflict {
		t.Fatalf("expected self-disable conflict, got %v", err)
	}
}
