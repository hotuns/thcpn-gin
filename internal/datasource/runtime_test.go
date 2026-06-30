package datasource

import (
	"context"
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
			DatabaseName:   &databaseName,
			SchemaName:     &schemaName,
			TableName:      "device_data",
			DeviceKeyField: "sn",
			DeviceKeyValue: "SN-001",
			TimeField:      "captured_at",
			ValueField:     "temperature",
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
			DatabaseName:   &databaseName,
			TableName:      "media_index",
			DeviceKeyField: "sn",
			DeviceKeyValue: "SN-001",
			TimeField:      "captured_at",
			ValueField:     "object_key",
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
			SchemaName:     &schemaName,
			TableName:      "media_index",
			DeviceKeyField: "sn",
			DeviceKeyValue: "SN-001",
			TimeField:      "captured_at",
			ValueField:     "object_key",
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
			DatabaseName:   &databaseName,
			TableName:      "media_index",
			DeviceKeyField: "sn",
			DeviceKeyValue: "SN-001",
			TimeField:      "captured_at",
			ValueField:     "object_key",
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
			ID:              uuid.New(),
			DataStreamID:    uuid.New(),
			DataSourceID:    uuid.New(),
			TableName:       "device_data",
			DeviceKeyField:  "serial_no",
			DeviceKeyValue:  "SN-001",
			TimeField:       "collected_at",
			ValueField:      "soil_moisture",
			PayloadType:     "json",
			QueryConfigJSON: json.RawMessage(`{"path":"/v1/telemetry"}`),
			Status:          "active",
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
			ID:              uuid.New(),
			DataStreamID:    uuid.New(),
			DataSourceID:    uuid.New(),
			TableName:       "media_index",
			DeviceKeyField:  "sn",
			DeviceKeyValue:  "CAM-001",
			TimeField:       "captured_at",
			ValueField:      "object_key",
			PayloadType:     "media",
			QueryConfigJSON: json.RawMessage(`{"method":"POST","path":"media/search"}`),
			Status:          "active",
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

type staticResolver string

func (s staticResolver) Resolve(context.Context, string) (string, error) {
	return string(s), nil
}
