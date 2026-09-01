package billing

import (
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestBillingPolicyAndDownloadValidation(t *testing.T) {
	service := NewService(nil, Policy{BaseHistoryDays: 90, BaseExportDays: 7, ProfessionalDefaultMonths: 12})
	if service.BaseHistoryDays() != 90 || service.BaseExportDays() != 7 {
		t.Fatalf("unexpected base policy: %d/%d", service.BaseHistoryDays(), service.BaseExportDays())
	}
	if err := service.ReserveDownload(t.Context(), ReserveDownloadInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected reservation validation error, got %v", err)
	}
	input := ReserveDownloadInput{WorkspaceID: uuid.New(), Bytes: 1, ObjectKey: "file", IdempotencyKey: "key", SourceType: "unknown"}
	if err := service.ReserveDownload(t.Context(), input); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected source type validation error, got %v", err)
	}
	if _, err := service.GrantProfessional(t.Context(), uuid.New(), uuid.New(), GrantProfessionalInput{}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected grant validation error, got %v", err)
	}
}
