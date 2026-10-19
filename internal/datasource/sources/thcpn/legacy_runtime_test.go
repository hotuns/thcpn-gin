package thcpn

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"time"

	"github.com/google/uuid"
)

func TestTHCPNLegacyAdapterValidation(t *testing.T) {
	runtime := newTestRuntime(staticResolver("unused"))
	source := platform.DataSource{
		ID:           uuid.New(),
		Type:         "postgres",
		DsnSecretRef: "secret:mysql",
		Status:       "active",
	}
	binding := platform.DataStreamBinding{
		ID:                uuid.New(),
		DataStreamID:      uuid.New(),
		DataSourceID:      uuid.New(),
		AdapterCode:       platform.AdapterTHCPNLegacy,
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{}`),
		Status:            "active",
	}

	_, telemetryErr := runtime.QueryTelemetry(context.Background(), source, platform.TelemetryQuery{
		Binding: binding,
		Start:   time.Now().Add(-time.Hour),
		End:     time.Now(),
		Limit:   10,
	})
	if apperr.KindOf(telemetryErr) != apperr.KindDataSource {
		t.Fatalf("expected thcpn legacy mysql source type error, got %v", telemetryErr)
	}

	source.Type = "mysql"
	binding.PayloadType = "media"
	_, mediaErr := runtime.QueryMedia(context.Background(), source, platform.MediaQuery{
		Binding:  binding,
		Start:    time.Now().Add(-time.Hour),
		End:      time.Now(),
		Page:     1,
		PageSize: 10,
	})
	if apperr.KindOf(mediaErr) != apperr.KindInvalidArgument {
		t.Fatalf("expected thcpn legacy adapter_config validation error, got %v", mediaErr)
	}
}
func TestTHCPNLegacyConfigParsingAndPaths(t *testing.T) {
	cfg, err := parseTHCPNLegacyTelemetryConfig(json.RawMessage(`{"external_device_id":1206,"json_key":"pm2.5"}`))
	if err != nil {
		t.Fatalf("parse thcpn telemetry config: %v", err)
	}
	if cfg.ExternalDeviceID != 1206 || cfg.RowType != "data" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.ValuePath != `$."pm2.5".value` {
		t.Fatalf("unexpected JSON path: %s", cfg.ValuePath)
	}
	if directPath := thcpnJSONDirectPath("pm2.5"); directPath != `$."pm2.5"` {
		t.Fatalf("unexpected direct JSON path: %s", directPath)
	}
	if cfg.TableIndex != defaultTHCPNTableIndexField || cfg.TimeField != defaultTHCPNTimeField {
		t.Fatalf("expected default table/time fields, got %#v", cfg)
	}

	if err := validateTHCPNShardTableName("device_data_154"); err != nil {
		t.Fatalf("expected valid shard table: %v", err)
	}
	if err := validateTHCPNShardTableName("device_data_154;drop"); apperr.KindOf(err) != apperr.KindDataSource {
		t.Fatalf("expected invalid shard table, got %v", err)
	}
}
func TestTHCPNMonthlyShardRouting(t *testing.T) {
	cutoverStart := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	beforeCutover := cutoverStart.Add(-time.Second)

	if !useMonthlyTHCPNShards(cutoverStart) {
		t.Fatal("expected the cutover date to use monthly shard tables")
	}
	if useMonthlyTHCPNShards(beforeCutover) {
		t.Fatal("expected dates before the cutover to use the shard index")
	}

	shards, err := monthlyTHCPNShardTables(
		cutoverStart,
		time.Date(2026, time.July, 31, 23, 59, 59, 0, time.UTC), defaultTHCPNMaxShardTables,
	)
	if err != nil {
		t.Fatalf("build monthly shard tables: %v", err)
	}
	if len(shards) != 1 || shards[0].Name != "device_data_202607" {
		t.Fatalf("unexpected July shard tables: %#v", shards)
	}
}
func TestTHCPNMonthlyShardTablesAcrossMonths(t *testing.T) {
	shards, err := monthlyTHCPNShardTables(
		time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC),
		time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC), defaultTHCPNMaxShardTables,
	)
	if err != nil {
		t.Fatalf("build monthly shard tables: %v", err)
	}
	want := []string{"device_data_202607", "device_data_202608", "device_data_202609"}
	if len(shards) != len(want) {
		t.Fatalf("unexpected monthly shard count: got %d, want %d", len(shards), len(want))
	}
	for i, shard := range shards {
		if shard.Name != want[i] {
			t.Fatalf("unexpected monthly shard at %d: got %q, want %q", i, shard.Name, want[i])
		}
	}
}
func TestTHCPNAdaptiveTelemetryCollectorKeepsRawPointsWithinLimit(t *testing.T) {
	start := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	collector := platform.NewAdaptiveTelemetryCollector(start, start.Add(time.Hour), 3, 4)
	for i, value := range []float64{3, 1, 2} {
		collector.Add(platform.TelemetryPoint{Timestamp: start.Add(time.Duration(i) * time.Minute), Value: value, Quality: "valid"})
	}
	points, sampled := collector.Result()
	if sampled {
		t.Fatal("expected raw points below the limit")
	}
	if len(points) != 3 || collector.SourceCount != 3 {
		t.Fatalf("unexpected raw result: points=%d source=%d", len(points), collector.SourceCount)
	}
}
func TestTHCPNAdaptiveTelemetryCollectorPreservesBucketExtremes(t *testing.T) {
	start := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	collector := platform.NewAdaptiveTelemetryCollector(start, start.Add(time.Hour), 2, 4)
	values := []float64{5, -10, 30, 8, 2, 20}
	for i, value := range values {
		collector.Add(platform.TelemetryPoint{Timestamp: start.Add(time.Duration(i*10) * time.Minute), Value: value, Quality: "valid"})
	}
	points, sampled := collector.Result()
	if !sampled {
		t.Fatal("expected points above the raw limit to be sampled")
	}
	if len(points) > 6 || collector.SourceCount != len(values) {
		t.Fatalf("unexpected sampled result: points=%d source=%d", len(points), collector.SourceCount)
	}
	seenMin := false
	seenMax := false
	for _, point := range points {
		seenMin = seenMin || point.Value == -10
		seenMax = seenMax || point.Value == 30
	}
	if !seenMin || !seenMax {
		t.Fatalf("expected sampled points to preserve extremes: %#v", points)
	}
}
func TestParseTHCPNTelemetryValueSkipsConfigMismatches(t *testing.T) {
	tests := []struct {
		name  string
		raw   sql.NullString
		ok    bool
		value float64
	}{
		{name: "number", raw: sql.NullString{String: "26.38", Valid: true}, ok: true, value: 26.38},
		{name: "missing json path", raw: sql.NullString{}, ok: false},
		{name: "empty value", raw: sql.NullString{String: " ", Valid: true}, ok: false},
		{name: "json null", raw: sql.NullString{String: "null", Valid: true}, ok: false},
		{name: "object shape mismatch", raw: sql.NullString{String: `{"value":26.38}`, Valid: true}, ok: false},
		{name: "non numeric value", raw: sql.NullString{String: "bad", Valid: true}, ok: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value, ok := parseTHCPNTelemetryValue(tt.raw)
			if ok != tt.ok {
				t.Fatalf("expected ok=%v, got %v", tt.ok, ok)
			}
			if ok && value != tt.value {
				t.Fatalf("expected value %v, got %v", tt.value, value)
			}
		})
	}
}
func TestParseTHCPNBatchTelemetryValueSupportsLegacyAndDirectShapes(t *testing.T) {
	tests := []struct {
		name  string
		raw   json.RawMessage
		ok    bool
		value float64
	}{
		{name: "direct number", raw: json.RawMessage(`26.38`), ok: true, value: 26.38},
		{name: "numeric string", raw: json.RawMessage(`"12.91"`), ok: true, value: 12.91},
		{name: "legacy nested number", raw: json.RawMessage(`{"value":25.2}`), ok: true, value: 25.2},
		{name: "legacy nested string", raw: json.RawMessage(`{"value":"99"}`), ok: true, value: 99},
		{name: "missing", raw: nil, ok: false},
		{name: "null", raw: json.RawMessage(`null`), ok: false},
		{name: "not a number", raw: json.RawMessage(`"bad"`), ok: false},
		{name: "nan", raw: json.RawMessage(`"NaN"`), ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			value, ok := parseTHCPNBatchTelemetryValue(tt.raw)
			if ok != tt.ok || (ok && value != tt.value) {
				t.Fatalf("got value=%v ok=%v, want value=%v ok=%v", value, ok, tt.value, tt.ok)
			}
		})
	}
}
func TestTHCPNTelemetryBatchGroupSeparatesIncompatibleSources(t *testing.T) {
	base := thcpnLegacyBindingConfig{
		ExternalDeviceID: 1206,
		RowType:          "data",
		TableIndex:       "device_data_index",
		TableNameField:   "table_name",
		IndexStartField:  "start_time",
		IndexEndField:    "end_time",
		DeviceIDField:    "device_id",
		DataField:        "data",
		TimeField:        "ts",
		TypeField:        "type",
		DeletedAtField:   "deleted_at",
		MaxShardTables:   8,
	}
	otherMetric := base
	otherMetric.JSONKey = "temp"
	if thcpnTelemetryBatchGroupKey(base) != thcpnTelemetryBatchGroupKey(otherMetric) {
		t.Fatal("metric JSON keys must share one source scan")
	}
	otherDevice := base
	otherDevice.ExternalDeviceID++
	if thcpnTelemetryBatchGroupKey(base) == thcpnTelemetryBatchGroupKey(otherDevice) {
		t.Fatal("different external devices must not share a source scan")
	}
}
func TestBuildTHCPNStreamSpecs(t *testing.T) {
	dataJSON := json.RawMessage(`[
		{"desc":"nh122","params":{"contents":[
			{"key":"temp","info":{"name":"Air temperature","unit":"C"}},
			{"key":"pm2.5","info":{"name":"PM2.5","unit":"ug/m3"}}
		]}},
		{"desc":"duplicate","params":{"contents":[
			{"key":"temp","info":{"name":"Backup temperature","unit":"C"}}
		]}}
	]`)
	imageJSON := json.RawMessage(`[{"key":"key1","dest":"Visible"}]`)

	specs, err := buildTHCPNStreamSpecs(1206, dataJSON, imageJSON)
	if err != nil {
		t.Fatalf("build stream specs: %v", err)
	}
	if len(specs) != 4 {
		t.Fatalf("unexpected spec count: %d", len(specs))
	}
	if specs[0].Code != "temp" || specs[0].Type != "telemetry" || specs[0].PayloadType != "columns" {
		t.Fatalf("unexpected first telemetry spec: %#v", specs[0])
	}
	if specs[1].Code != "pm2.5" || specs[1].Unit != "ug/m3" {
		t.Fatalf("unexpected pm spec: %#v", specs[1])
	}
	if specs[2].Code != "temp_2" {
		t.Fatalf("expected duplicate key suffix, got %#v", specs[2])
	}
	if specs[3].Code != "key1" || specs[3].Type != "image" || specs[3].PayloadType != "media" {
		t.Fatalf("unexpected image spec: %#v", specs[3])
	}
}

type staticResolver string

func (s staticResolver) Resolve(context.Context, string) (string, error) {
	return string(s), nil
}
func testStringPtr(value string) *string {
	return &value
}
