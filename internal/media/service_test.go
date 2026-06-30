package media

import (
	"testing"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestNormalizePage(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100}

	page, pageSize, err := normalizePage(0, 0, limits)
	if err != nil {
		t.Fatalf("default page: %v", err)
	}
	if page != 1 || pageSize != 100 {
		t.Fatalf("unexpected default page/page_size: %d/%d", page, pageSize)
	}

	if _, _, err := normalizePage(1, 101, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected page size limit error, got %v", err)
	}
}

func TestValidateTimeRange(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxMediaPageSize: 100}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(2 * time.Hour)
	if err := validateTimeRange(start, end, limits); err != nil {
		t.Fatalf("expected valid range, got %v", err)
	}
	if err := validateTimeRange(end, start, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid reversed range, got %v", err)
	}
}

func TestIsMediaStreamType(t *testing.T) {
	for _, value := range []string{"image", "video", "audio"} {
		if !isMediaStreamType(value) {
			t.Fatalf("expected %q to be media stream type", value)
		}
	}
	if isMediaStreamType("telemetry") {
		t.Fatal("telemetry should not be media stream type")
	}
}
