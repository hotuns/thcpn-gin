package telemetry

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/systemsettings"
	"time"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestValidateTimeRange(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 366, MaxPoints: 5000}
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	if err := validateTimeRange(start, end, limits); err != nil {
		t.Fatalf("expected valid time range, got %v", err)
	}

	if err := validateTimeRange(end, start, limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid reversed range, got %v", err)
	}

	if err := validateTimeRange(start, start.Add(367*24*time.Hour), limits); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected range limit error, got %v", err)
	}
}

func TestNormalizeLimit(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 366, MaxPoints: 5000}
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

func TestConfiguredQueryLimitDetails(t *testing.T) {
	limits := config.QueryLimitsConfig{MaxHistoryDays: 3, MaxPoints: 17}
	start := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	if err := validateTimeRange(start, start.Add(72*time.Hour), limits); err != nil {
		t.Fatal(err)
	}
	err := validateTimeRange(start, start.Add(72*time.Hour+time.Second), limits)
	details := apperr.DetailsOf(err)
	if details["field"] != "query_days" || details["maximum"] != int64(3) || details["actual"] != int64(4) {
		t.Fatalf("must report actual configured window: %v", details)
	}
	_, err = normalizeLimit(18, limits)
	if d := apperr.DetailsOf(err); d["maximum"] != int64(17) || d["actual"] != int64(18) {
		t.Fatalf("wrong point limit: %v", d)
	}
	_, err = normalizeTargetPoints(18, true, limits)
	if d := apperr.DetailsOf(err); d["field"] != "target_points" || d["maximum"] != int64(17) {
		t.Fatalf("wrong target limit: %v", d)
	}
}

func TestRequestPolicyIsEnforcedBeforeReadingSource(t *testing.T) {
	ctx := systemsettings.With(t.Context(), systemsettings.Values{"query_days": 2, "query_points": 37})
	service := NewService(nil, nil, nil, config.Default().QueryLimits)
	id := uuid.New()
	start := time.Now().Add(-72 * time.Hour)
	_, err := service.Query(ctx, QueryInput{DeviceID: &id, StartTime: start, EndTime: time.Now(), Limit: 38})
	if d := apperr.DetailsOf(err); d["field"] != "query_points" || d["maximum"] != int64(37) {
		t.Fatalf("policy ignored: %v %v", err, d)
	}
	_, err = service.Query(ctx, QueryInput{DeviceID: &id, StartTime: start, EndTime: time.Now(), Limit: 2})
	if d := apperr.DetailsOf(err); d["field"] != "query_days" || d["maximum"] != int64(2) {
		t.Fatalf("range policy ignored: %v %v", err, d)
	}
}
