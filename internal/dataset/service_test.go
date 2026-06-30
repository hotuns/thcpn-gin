package dataset

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/config"
)

func TestNormalizeSourcesDeduplicates(t *testing.T) {
	sourceID := uuid.New()
	sources, err := normalizeSources([]SourceInput{
		{SourceType: "device", SourceID: sourceID},
		{SourceType: "device", SourceID: sourceID},
	})
	if err != nil {
		t.Fatalf("expected sources to be valid: %v", err)
	}
	if len(sources) != 1 {
		t.Fatalf("expected duplicate source to be removed, got %v", sources)
	}
}

func TestNormalizeSourcesRejectsInvalidType(t *testing.T) {
	_, err := normalizeSources([]SourceInput{{SourceType: "raw_sql", SourceID: uuid.New()}})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid source type to be rejected, got %v", err)
	}
}

func TestDatasetValidation(t *testing.T) {
	if !isValidDataType("mixed") || isValidDataType("sql") {
		t.Fatal("unexpected data type validation result")
	}
	if !isValidStatus("published") || isValidStatus("deleted") {
		t.Fatal("unexpected status validation result")
	}
	if !isValidSourceType("data_stream") || isValidSourceType("table") {
		t.Fatal("unexpected source type validation result")
	}
}

func TestValidateTimeRange(t *testing.T) {
	start := time.Now()
	end := start.Add(-time.Hour)
	if apperr.KindOf(validateTimeRange(start, end)) != apperr.KindInvalidArgument {
		t.Fatal("expected invalid time range")
	}
	if err := validateTimeRange(start, start.Add(time.Hour)); err != nil {
		t.Fatalf("expected valid time range: %v", err)
	}
}

func TestResolveTelemetryQueryRangeDefaultsToDatasetRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(24 * time.Hour)

	start, end, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, time.Time{}, time.Time{}, config.QueryLimitsConfig{MaxHistoryDays: 31})
	if err != nil {
		t.Fatalf("resolve range: %v", err)
	}
	if !start.Equal(datasetStart) || !end.Equal(datasetEnd) {
		t.Fatalf("unexpected resolved range: %s - %s", start, end)
	}
}

func TestResolveTelemetryQueryRangeRejectsOutsideDatasetRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(24 * time.Hour)

	_, _, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, datasetStart.Add(-time.Second), datasetEnd, config.QueryLimitsConfig{MaxHistoryDays: 31})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected outside range error, got %v", err)
	}
}

func TestResolveTelemetryQueryRangeRejectsLargeSynchronousRange(t *testing.T) {
	datasetStart := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	datasetEnd := datasetStart.Add(48 * time.Hour)

	_, _, err := resolveTelemetryQueryRange(datasetStart, datasetEnd, time.Time{}, time.Time{}, config.QueryLimitsConfig{MaxHistoryDays: 1})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected max history range error, got %v", err)
	}
}

func TestNormalizeTelemetryQueryLimit(t *testing.T) {
	limit, err := normalizeTelemetryQueryLimit(0, config.QueryLimitsConfig{MaxPoints: 100})
	if err != nil {
		t.Fatalf("default query limit: %v", err)
	}
	if limit != 100 {
		t.Fatalf("expected default max points, got %d", limit)
	}
	if _, err := normalizeTelemetryQueryLimit(101, config.QueryLimitsConfig{MaxPoints: 100}); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected max points error, got %v", err)
	}
}
