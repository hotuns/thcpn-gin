package export

import (
	"context"
	"errors"
	"testing"
	"time"

	platform "thcpn-gin/internal/datasource/platform"
)

type segmentedRuntime struct {
	telemetry func(platform.TelemetryQuery) (platform.TelemetryResult, error)
	media     func(platform.MediaQuery) (platform.MediaResult, error)
}

func (r segmentedRuntime) QueryTelemetry(_ context.Context, _ platform.DataSource, q platform.TelemetryQuery) (platform.TelemetryResult, error) {
	return r.telemetry(q)
}
func (r segmentedRuntime) QueryMedia(_ context.Context, _ platform.DataSource, q platform.MediaQuery) (platform.MediaResult, error) {
	return r.media(q)
}

func TestLongExportTelemetrySplitsAndMergesInclusiveBoundaries(t *testing.T) {
	start := time.Date(2025, 7, 29, 16, 0, 0, 0, time.UTC)
	end := time.Date(2026, 10, 27, 6, 3, 0, 0, time.UTC)
	calls := 0
	previous := start
	p := &Processor{runtime: segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
		calls++
		if q.End.Sub(q.Start) > 30*24*time.Hour || !q.Start.Equal(previous) {
			t.Fatalf("invalid segment: %+v", q)
		}
		previous = q.End
		return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start, Value: 1}, {Timestamp: q.End, Value: 1}}}, nil
	}}}
	points, err := p.queryExportTelemetry(t.Context(), platform.DataSource{}, platform.TelemetryQuery{Start: start, End: end, Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	if calls < 15 || len(points) != calls+1 || !previous.Equal(end) {
		t.Fatalf("calls=%d points=%d end=%s", calls, len(points), previous)
	}
	if !points[0].Timestamp.Equal(start) || !points[len(points)-1].Timestamp.Equal(end) {
		t.Fatal("lost outer boundary")
	}
}
func TestSegmentedTelemetryRetriesLimitAndRejectsPartialFailures(t *testing.T) {
	start := time.Now()
	end := start.Add(31 * 24 * time.Hour)
	calls := 0
	p := &Processor{runtime: segmentedRuntime{telemetry: func(q platform.TelemetryQuery) (platform.TelemetryResult, error) {
		calls++
		if calls == 1 {
			return platform.TelemetryResult{Complete: false}, nil
		}
		if q.Start.After(start) {
			return platform.TelemetryResult{}, errors.New("upstream offline")
		}
		if q.Limit != 20 {
			t.Fatalf("limit=%d", q.Limit)
		}
		return platform.TelemetryResult{Complete: true, Points: []platform.TelemetryPoint{{Timestamp: q.Start}}}, nil
	}}}
	points, err := p.queryExportTelemetry(t.Context(), platform.DataSource{}, platform.TelemetryQuery{Start: start, End: end, Limit: 10})
	if err == nil || points != nil {
		t.Fatalf("partial read silently accepted: %v %v", points, err)
	}
}
func TestSegmentedMediaResetsPaginationAndKeepsDistinctImages(t *testing.T) {
	start := time.Now()
	end := start.Add(31 * 24 * time.Hour)
	calls := 0
	p := &Processor{runtime: segmentedRuntime{media: func(q platform.MediaQuery) (platform.MediaResult, error) {
		calls++
		if q.PageSize != 1 {
			t.Fatalf("page size=%d", q.PageSize)
		}
		if q.Start.Equal(start) {
			if q.Page == 1 {
				return platform.MediaResult{Total: 2, Items: []platform.MediaRecord{{ID: "first", ObjectKey: "first.jpg", CapturedAt: q.Start}}}, nil
			}
			if q.Page != 2 {
				t.Fatalf("page=%d", q.Page)
			}
			return platform.MediaResult{Total: 2, Items: []platform.MediaRecord{{ID: "boundary", ObjectKey: "boundary.jpg", CapturedAt: q.End}}}, nil
		}
		if q.Page != 1 {
			t.Fatalf("new segment did not reset page: %d", q.Page)
		}
		return platform.MediaResult{Total: 1, Items: []platform.MediaRecord{{ID: "boundary", ObjectKey: "boundary.jpg", CapturedAt: q.Start}}}, nil
	}}}
	records, err := p.queryExportMedia(t.Context(), platform.DataSource{}, platform.MediaQuery{Start: start, End: end, PageSize: 1})
	if err != nil || calls != 3 || len(records) != 2 {
		t.Fatalf("calls=%d records=%v err=%v", calls, records, err)
	}
}
func TestBatchReadFailuresCannotProduceSuccessfulEmptyArchive(t *testing.T) {
	for _, tc := range []struct {
		name string
		rows []qualityReportRow
		fail bool
	}{
		{"all reads failed", []qualityReportRow{{Status: "missing"}, {Status: "missing"}}, true},
		{"all downloads failed", []qualityReportRow{{Status: "missing"}, {Status: "packed", Count: 0}}, true},
		{"partial success", []qualityReportRow{{Status: "missing"}, {Status: "packed", Count: 1}}, false},
		{"genuinely empty", []qualityReportRow{{Status: "packed", Count: 0}}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := validateBatchReadResults(tc.rows); (err != nil) != tc.fail {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestSegmentedQueryCancellationStopsBeforeReading(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	p := &Processor{runtime: segmentedRuntime{telemetry: func(platform.TelemetryQuery) (platform.TelemetryResult, error) {
		t.Fatal("queried after cancellation")
		return platform.TelemetryResult{}, nil
	}}}
	_, err := p.queryExportTelemetry(ctx, platform.DataSource{}, platform.TelemetryQuery{Start: time.Now(), End: time.Now().Add(time.Hour)})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
}

func TestSegmentedTelemetryRefusesSampledOrTruncatedData(t *testing.T) {
	p := &Processor{runtime: segmentedRuntime{telemetry: func(platform.TelemetryQuery) (platform.TelemetryResult, error) {
		return platform.TelemetryResult{Complete: true, Sampled: true}, nil
	}}}
	_, err := p.queryExportTelemetry(t.Context(), platform.DataSource{}, platform.TelemetryQuery{Start: time.Now(), End: time.Now().Add(time.Hour), Limit: maxExportTelemetryPoints})
	if err == nil {
		t.Fatal("accepted sampled data as a full export")
	}
}
