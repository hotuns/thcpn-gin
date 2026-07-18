package telemetry

import (
	"testing"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestValidateTimeRange(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxPoints: 5000}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	if err := validateTimeRange(start, end, limits); err != nil {
		t.Fatalf("expected valid time range, got %v", err)
	}

	if err := validateTimeRange(end, start, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid reversed range, got %v", err)
	}

	if err := validateTimeRange(start, start.Add(32*24*time.Hour), limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected range limit error, got %v", err)
	}
}

func TestNormalizeLimit(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 31, MaxPoints: 5000}
	limit, err := normalizeLimit(0, limits)
	if err != nil {
		t.Fatalf("default limit: %v", err)
	}
	if limit != 5000 {
		t.Fatalf("expected max default, got %d", limit)
	}

	if _, err := normalizeLimit(5001, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected max points error, got %v", err)
	}
}

func TestNormalizeTargetPoints(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxPoints: 5000}
	target, err := normalizeTargetPoints(0, true, limits)
	if err != nil || target != 1000 {
		t.Fatalf("expected adaptive default target, got target=%d err=%v", target, err)
	}
	if target, err := normalizeTargetPoints(1000, false, limits); err != nil || target != 0 {
		t.Fatalf("expected non-adaptive target to be ignored, got target=%d err=%v", target, err)
	}
	if _, err := normalizeTargetPoints(5001, true, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected target point limit error, got %v", err)
	}
}
