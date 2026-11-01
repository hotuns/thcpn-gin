package billing

import (
	"testing"
	"thcpn-gin/internal/systemsettings"
	"time"

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

func TestBillingSwitchAndAllowanceUseRuntimePolicy(t *testing.T) {
	service := NewService(nil, Policy{MonthlyDownloadLimitBytes: 1000, BaseHistoryDays: 90, BaseExportDays: 7})
	now := time.Now()
	start := now.Add(-time.Hour)
	end := now.Add(time.Hour)
	off := systemsettings.With(t.Context(), systemsettings.Values{"billing_enabled": 0})
	summary := service.makeSummary(uuid.New(), nil, nil, 0, 0, now, off)
	if summary.Plan != PlanProfessional || !summary.Unlimited {
		t.Fatalf("billing off still restricted: %+v", summary)
	}
	on := systemsettings.With(t.Context(), systemsettings.Values{"billing_enabled": 1, "base_history_days": 15, "base_export_days": 3, "monthly_download_gb": 2})
	summary = service.makeSummary(uuid.New(), &start, &end, 0, 0, now, on)
	if summary.Unlimited || summary.MonthlyDownloadLimitBytes != 2*1024*1024*1024 || summary.BaseHistoryDays != 15 || summary.BaseExportDays != 3 {
		t.Fatalf("runtime billing values ignored: %+v", summary)
	}
}
