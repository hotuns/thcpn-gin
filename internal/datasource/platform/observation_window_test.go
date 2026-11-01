package platform

import (
	"context"
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/observation"
	"time"
)

func TestRuntimeWindowAffectsBatchQueriesBeforeLimitAndSkipsEmptyRanges(t *testing.T) {
	r := NewRuntime(nil)
	start := time.Now().UTC().Truncate(time.Second)
	end := start.Add(time.Hour)
	a, b := uuid.New(), uuid.New()
	r.Window = func(ctx context.Context, id uuid.UUID, from, to time.Time) (time.Time, time.Time, bool, error) {
		cutoff := start.Add(30 * time.Minute)
		if id == b {
			cutoff = end.Add(time.Hour)
		}
		from, to, ok := observation.Clip(observation.Phase(ctx), &cutoff, from, to)
		return from, to, ok, nil
	}
	calls := 0
	r.BatchReaders = map[string]func(context.Context, DataSource, TelemetryBatchQuery) (TelemetryBatchResult, error){"test": func(ctx context.Context, _ DataSource, q TelemetryBatchQuery) (TelemetryBatchResult, error) {
		calls++
		if q.Limit != 1 || !q.Start.Equal(start.Add(30*time.Minute)) || len(q.Bindings) != 1 {
			t.Fatalf("upstream window/limit: %+v", q)
		}
		return TelemetryBatchResult{Series: map[uuid.UUID]TelemetryResult{a: {Points: []TelemetryPoint{{Timestamp: q.Start, Value: 1}}, Complete: true}}}, nil
	}}
	source := DataSource{Status: "active"}
	q := TelemetryBatchQuery{Bindings: []DataStreamBinding{{DataStreamID: a, Status: "active", AdapterCode: "test"}, {DataStreamID: b, Status: "active", AdapterCode: "test"}}, Start: start, End: end, Limit: 1}
	result, err := r.QueryTelemetryBatch(t.Context(), source, q)
	if err != nil || calls != 1 || len(result.Series[a].Points) != 1 || len(result.Series[b].Points) != 0 || !result.Series[b].Complete {
		t.Fatalf("formal query: %+v %v", result, err)
	}
	r.MediaReaders = map[string]func(context.Context, DataSource, MediaQuery) (MediaResult, error){"test": func(context.Context, DataSource, MediaQuery) (MediaResult, error) {
		t.Fatal("test-only media range reached source")
		return MediaResult{}, nil
	}}
	images, err := r.QueryMedia(t.Context(), source, MediaQuery{Binding: DataStreamBinding{DataStreamID: b, AdapterCode: "test", Status: "active"}, Start: start, End: end})
	if err != nil || images.Total != 0 {
		t.Fatal("media boundary not enforced")
	}
}
