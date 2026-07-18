package workspace

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestNormalizeGovernancePage(t *testing.T) {
	page, pageSize := normalizePage(0, 0)
	if page != 1 || pageSize != 20 {
		t.Fatalf("normalizePage(0, 0) = %d, %d", page, pageSize)
	}
	page, pageSize = normalizePage(3, 500)
	if page != 3 || pageSize != 100 {
		t.Fatalf("normalizePage(3, 500) = %d, %d", page, pageSize)
	}
}

func TestStartInterventionValidatesBeforeDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.StartIntervention(context.Background(), uuid.New(), uuid.New(), "短", 30)
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for short reason, got %v", err)
	}
	_, err = service.StartIntervention(context.Background(), uuid.New(), uuid.New(), "修复异常权限范围", 10)
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for duration, got %v", err)
	}
}

func TestAdminStatusRejectsUnknownValueBeforeDatabase(t *testing.T) {
	service := &Service{}
	_, err := service.AdminUpdateStatus(context.Background(), uuid.New(), "archived")
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}
