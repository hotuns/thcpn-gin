package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	mysql "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestBuildTelemetryQueryPlanDialects(t *testing.T) {
	databaseName := "device_db"
	schemaName := "public"
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	req := TelemetryQuery{
		Binding: DataStreamBinding{
			AdapterCode:    AdapterGenericColumns,
			DatabaseName:   &databaseName,
			SchemaName:     &schemaName,
			TableName:      testStringPtr("device_data"),
			DeviceKeyField: testStringPtr("sn"),
			DeviceKeyValue: testStringPtr("SN-001"),
			TimeField:      testStringPtr("captured_at"),
			ValueField:     testStringPtr("temperature"),
			PayloadType:    "columns",
		},
		Start: start,
		End:   end,
		Limit: 100,
	}

	postgresPlan, err := buildTelemetryQueryPlan(req, postgresDialect)
	if err != nil {
		t.Fatalf("build postgres plan: %v", err)
	}
	expectedPostgres := `SELECT "captured_at", "temperature"::double precision FROM "public"."device_data" WHERE "sn" = $1 AND "captured_at" >= $2 AND "captured_at" <= $3 ORDER BY "captured_at" ASC LIMIT $4`
	if postgresPlan.Query != expectedPostgres {
		t.Fatalf("unexpected postgres query:\n%s", postgresPlan.Query)
	}
	if len(postgresPlan.Args) != 4 || postgresPlan.Args[0] != "SN-001" || postgresPlan.Args[3] != 100 {
		t.Fatalf("unexpected postgres args: %#v", postgresPlan.Args)
	}

	mysqlPlan, err := buildTelemetryQueryPlan(req, mysqlDialect)
	if err != nil {
		t.Fatalf("build mysql plan: %v", err)
	}
	expectedMySQL := "SELECT `captured_at`, CAST(`temperature` AS DOUBLE) FROM `device_db`.`device_data` WHERE `sn` = ? AND `captured_at` >= ? AND `captured_at` <= ? ORDER BY `captured_at` ASC LIMIT ?"
	if mysqlPlan.Query != expectedMySQL {
		t.Fatalf("unexpected mysql query:\n%s", mysqlPlan.Query)
	}
	if len(mysqlPlan.Args) != 4 || mysqlPlan.Args[0] != "SN-001" || mysqlPlan.Args[3] != 100 {
		t.Fatalf("unexpected mysql args: %#v", mysqlPlan.Args)
	}

	clickHousePlan, err := buildTelemetryQueryPlan(req, clickHouseDialect)
	if err != nil {
		t.Fatalf("build clickhouse plan: %v", err)
	}
	expectedClickHouse := "SELECT `captured_at`, CAST(`temperature` AS Float64) FROM `device_db`.`device_data` WHERE `sn` = ? AND `captured_at` >= ? AND `captured_at` <= ? ORDER BY `captured_at` ASC LIMIT ?"
	if clickHousePlan.Query != expectedClickHouse {
		t.Fatalf("unexpected clickhouse query:\n%s", clickHousePlan.Query)
	}
	if len(clickHousePlan.Args) != 4 || clickHousePlan.Args[0] != "SN-001" || clickHousePlan.Args[3] != 100 {
		t.Fatalf("unexpected clickhouse args: %#v", clickHousePlan.Args)
	}
}

func TestBuildMediaRowsQueryPlanMySQLDefaultMediaType(t *testing.T) {
	databaseName := "device_db"
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	req := MediaQuery{
		Binding: DataStreamBinding{
			AdapterCode:    AdapterGenericMedia,
			DatabaseName:   &databaseName,
			TableName:      testStringPtr("media_index"),
			DeviceKeyField: testStringPtr("sn"),
			DeviceKeyValue: testStringPtr("SN-001"),
			TimeField:      testStringPtr("captured_at"),
			ValueField:     testStringPtr("object_key"),
			PayloadType:    "media",
		},
		Start:    start,
		End:      end,
		Page:     2,
		PageSize: 25,
	}
	cfg := mediaBindingConfig{
		IDField:        "media_id",
		ObjectKeyField: "object_key",
		MediaType:      "image",
	}

	plan, err := buildMediaRowsQueryPlan(req, cfg, mysqlDialect)
	if err != nil {
		t.Fatalf("build mysql media plan: %v", err)
	}
	expected := "SELECT CAST(`media_id` AS CHAR), `captured_at`, CAST(`object_key` AS CHAR), CAST(NULL AS CHAR), CAST(? AS CHAR) FROM `device_db`.`media_index` WHERE `sn` = ? AND `captured_at` >= ? AND `captured_at` <= ? ORDER BY `captured_at` DESC LIMIT ? OFFSET ?"
	if plan.Query != expected {
		t.Fatalf("unexpected mysql media query:\n%s", plan.Query)
	}
	if len(plan.Args) != 6 {
		t.Fatalf("unexpected args: %#v", plan.Args)
	}
	if plan.Args[0] != "image" || plan.Args[1] != "SN-001" || plan.Args[4] != 25 || plan.Args[5] != 25 {
		t.Fatalf("unexpected mysql media args: %#v", plan.Args)
	}
}

func TestBuildMediaRowsQueryPlanPostgresMappedFields(t *testing.T) {
	schemaName := "public"
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	req := MediaQuery{
		Binding: DataStreamBinding{
			AdapterCode:    AdapterGenericMedia,
			SchemaName:     &schemaName,
			TableName:      testStringPtr("media_index"),
			DeviceKeyField: testStringPtr("sn"),
			DeviceKeyValue: testStringPtr("SN-001"),
			TimeField:      testStringPtr("captured_at"),
			ValueField:     testStringPtr("object_key"),
			PayloadType:    "media",
		},
		Start:    start,
		End:      end,
		Page:     1,
		PageSize: 10,
	}
	cfg := mediaBindingConfig{
		IDField:           "media_id",
		ObjectKeyField:    "object_key",
		ThumbnailKeyField: "thumb_key",
		MediaTypeField:    "kind",
	}

	plan, err := buildMediaRowsQueryPlan(req, cfg, postgresDialect)
	if err != nil {
		t.Fatalf("build postgres media plan: %v", err)
	}
	expected := `SELECT "media_id"::text, "captured_at", "object_key"::text, "thumb_key"::text, "kind"::text FROM "public"."media_index" WHERE "sn" = $1 AND "captured_at" >= $2 AND "captured_at" <= $3 ORDER BY "captured_at" DESC LIMIT $4 OFFSET $5`
	if plan.Query != expected {
		t.Fatalf("unexpected postgres media query:\n%s", plan.Query)
	}
	if len(plan.Args) != 5 || plan.Args[0] != "SN-001" || plan.Args[3] != 10 || plan.Args[4] != 0 {
		t.Fatalf("unexpected postgres media args: %#v", plan.Args)
	}
}

func TestBuildMediaRowsQueryPlanClickHouseDefaultMediaType(t *testing.T) {
	databaseName := "device_db"
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(24 * time.Hour)
	req := MediaQuery{
		Binding: DataStreamBinding{
			AdapterCode:    AdapterGenericMedia,
			DatabaseName:   &databaseName,
			TableName:      testStringPtr("media_index"),
			DeviceKeyField: testStringPtr("sn"),
			DeviceKeyValue: testStringPtr("SN-001"),
			TimeField:      testStringPtr("captured_at"),
			ValueField:     testStringPtr("object_key"),
			PayloadType:    "media",
		},
		Start:    start,
		End:      end,
		Page:     2,
		PageSize: 25,
	}
	cfg := mediaBindingConfig{
		IDField:        "media_id",
		ObjectKeyField: "object_key",
		MediaType:      "image",
	}

	plan, err := buildMediaRowsQueryPlan(req, cfg, clickHouseDialect)
	if err != nil {
		t.Fatalf("build clickhouse media plan: %v", err)
	}
	expected := "SELECT CAST(`media_id` AS String), `captured_at`, CAST(`object_key` AS String), CAST(NULL AS Nullable(String)), CAST(? AS String) FROM `device_db`.`media_index` WHERE `sn` = ? AND `captured_at` >= ? AND `captured_at` <= ? ORDER BY `captured_at` DESC LIMIT ? OFFSET ?"
	if plan.Query != expected {
		t.Fatalf("unexpected clickhouse media query:\n%s", plan.Query)
	}
	if len(plan.Args) != 6 {
		t.Fatalf("unexpected args: %#v", plan.Args)
	}
	if plan.Args[0] != "image" || plan.Args[1] != "SN-001" || plan.Args[4] != 25 || plan.Args[5] != 25 {
		t.Fatalf("unexpected clickhouse media args: %#v", plan.Args)
	}
}

func TestMySQLDSNWithParseTime(t *testing.T) {
	dsn, err := mysqlDSNWithParseTime("user:pass@tcp(127.0.0.1:3306)/device_data?charset=utf8mb4")
	if err != nil {
		t.Fatalf("normalize mysql dsn: %v", err)
	}
	cfg, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatalf("parse normalized dsn: %v", err)
	}
	if !cfg.ParseTime {
		t.Fatal("expected parseTime=true")
	}
	if cfg.DBName != "device_data" {
		t.Fatalf("unexpected db name: %q", cfg.DBName)
	}
}

func TestClickHouseOptionsFromDSN(t *testing.T) {
	opts, err := clickHouseOptionsFromDSN("clickhouse://reader:secret@127.0.0.1:9000/device_data?dial_timeout=2s")
	if err != nil {
		t.Fatalf("parse clickhouse dsn: %v", err)
	}
	if len(opts.Addr) != 1 || opts.Addr[0] != "127.0.0.1:9000" {
		t.Fatalf("unexpected addr: %#v", opts.Addr)
	}
	if opts.Auth.Database != "device_data" || opts.Auth.Username != "reader" || opts.Auth.Password != "secret" {
		t.Fatalf("unexpected auth: %#v", opts.Auth)
	}
}

func TestHTTPAPITelemetryQueryGET(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/v1/telemetry" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		query := r.URL.Query()
		if query.Get("serial_no") != "SN-001" {
			t.Fatalf("unexpected device key: %s", query.Get("serial_no"))
		}
		if query.Get("start_time") != start.Format(time.RFC3339Nano) || query.Get("end_time") != end.Format(time.RFC3339Nano) {
			t.Fatalf("unexpected time query: %s", query.Encode())
		}
		if query.Get("limit") != "25" {
			t.Fatalf("unexpected limit: %s", query.Get("limit"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"points":[{"ts":"2026-06-01T00:05:00Z","value":21.5}]}`))
	}))
	defer server.Close()

	runtime := NewRuntime(staticResolver(server.URL))
	result, err := runtime.QueryTelemetry(context.Background(), DataSource{
		ID:           uuid.New(),
		Type:         "http_api",
		DsnSecretRef: "secret:http",
		Status:       "active",
	}, TelemetryQuery{
		Binding: DataStreamBinding{
			ID:                uuid.New(),
			DataStreamID:      uuid.New(),
			DataSourceID:      uuid.New(),
			AdapterCode:       AdapterHTTPAPI,
			TableName:         testStringPtr("device_data"),
			DeviceKeyField:    testStringPtr("serial_no"),
			DeviceKeyValue:    testStringPtr("SN-001"),
			TimeField:         testStringPtr("collected_at"),
			ValueField:        testStringPtr("soil_moisture"),
			PayloadType:       "json",
			AdapterConfigJSON: json.RawMessage(`{"path":"/v1/telemetry"}`),
			Status:            "active",
		},
		Start: start,
		End:   end,
		Limit: 25,
	})
	if err != nil {
		t.Fatalf("query http telemetry: %v", err)
	}
	if len(result.Points) != 1 {
		t.Fatalf("unexpected point count: %d", len(result.Points))
	}
	if result.Points[0].Value != 21.5 || result.Points[0].Quality != "valid" {
		t.Fatalf("unexpected point: %#v", result.Points[0])
	}
}

func TestHTTPAPIMediaQueryPOST(t *testing.T) {
	start := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(time.Hour)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method: %s", r.Method)
		}
		if r.URL.Path != "/media/search" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		if body["sn"] != "CAM-001" || body["page"] != "2" || body["page_size"] != "10" || body["media_type"] != "image" {
			t.Fatalf("unexpected request body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"id":"img-1","captured_at":"2026-06-01T00:05:00Z","object_key":"raw/img-1.jpg","media_type":"image"}],"total":7}`))
	}))
	defer server.Close()

	runtime := NewRuntime(staticResolver(server.URL))
	result, err := runtime.QueryMedia(context.Background(), DataSource{
		ID:           uuid.New(),
		Type:         "http_api",
		DsnSecretRef: "secret:http",
		Status:       "active",
	}, MediaQuery{
		Binding: DataStreamBinding{
			ID:                uuid.New(),
			DataStreamID:      uuid.New(),
			DataSourceID:      uuid.New(),
			AdapterCode:       AdapterHTTPAPI,
			TableName:         testStringPtr("media_index"),
			DeviceKeyField:    testStringPtr("sn"),
			DeviceKeyValue:    testStringPtr("CAM-001"),
			TimeField:         testStringPtr("captured_at"),
			ValueField:        testStringPtr("object_key"),
			PayloadType:       "media",
			AdapterConfigJSON: json.RawMessage(`{"method":"POST","path":"media/search"}`),
			Status:            "active",
		},
		Start:     start,
		End:       end,
		Page:      2,
		PageSize:  10,
		MediaType: "image",
	})
	if err != nil {
		t.Fatalf("query http media: %v", err)
	}
	if result.Total != 7 || len(result.Items) != 1 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.Items[0].ObjectKey != "raw/img-1.jpg" {
		t.Fatalf("unexpected item: %#v", result.Items[0])
	}
}

func TestHTTPAPIPathRejectsAbsoluteURL(t *testing.T) {
	_, err := parseHTTPAPIConfig(json.RawMessage(`{"path":"https://example.com/telemetry"}`))
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestTHCPNLegacyAdapterValidation(t *testing.T) {
	runtime := NewRuntime(staticResolver("unused"))
	source := DataSource{
		ID:           uuid.New(),
		Type:         "postgres",
		DsnSecretRef: "secret:mysql",
		Status:       "active",
	}
	binding := DataStreamBinding{
		ID:                uuid.New(),
		DataStreamID:      uuid.New(),
		DataSourceID:      uuid.New(),
		AdapterCode:       AdapterTHCPNLegacy,
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{}`),
		Status:            "active",
	}

	_, telemetryErr := runtime.QueryTelemetry(context.Background(), source, TelemetryQuery{
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
	_, mediaErr := runtime.QueryMedia(context.Background(), source, MediaQuery{
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
		time.Date(2026, time.July, 31, 23, 59, 59, 0, time.UTC),
		defaultTHCPNMaxShardTables,
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
		time.Date(2026, time.September, 1, 0, 0, 0, 0, time.UTC),
		defaultTHCPNMaxShardTables,
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
	collector := newTHCPNAdaptiveTelemetryCollector(start, start.Add(time.Hour), 3, 4)
	for i, value := range []float64{3, 1, 2} {
		collector.Add(TelemetryPoint{Timestamp: start.Add(time.Duration(i) * time.Minute), Value: value, Quality: "valid"})
	}
	points, sampled := collector.Result()
	if sampled {
		t.Fatal("expected raw points below the limit")
	}
	if len(points) != 3 || collector.sourceCount != 3 {
		t.Fatalf("unexpected raw result: points=%d source=%d", len(points), collector.sourceCount)
	}
}

func TestTHCPNAdaptiveTelemetryCollectorPreservesBucketExtremes(t *testing.T) {
	start := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	collector := newTHCPNAdaptiveTelemetryCollector(start, start.Add(time.Hour), 2, 4)
	values := []float64{5, -10, 30, 8, 2, 20}
	for i, value := range values {
		collector.Add(TelemetryPoint{Timestamp: start.Add(time.Duration(i*10) * time.Minute), Value: value, Quality: "valid"})
	}
	points, sampled := collector.Result()
	if !sampled {
		t.Fatal("expected points above the raw limit to be sampled")
	}
	if len(points) > 6 || collector.sourceCount != len(values) {
		t.Fatalf("unexpected sampled result: points=%d source=%d", len(points), collector.sourceCount)
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
