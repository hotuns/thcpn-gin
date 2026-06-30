package dataset

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
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
