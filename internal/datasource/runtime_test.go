package datasource

import (
	"testing"
	"time"

	mysql "github.com/go-sql-driver/mysql"
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
