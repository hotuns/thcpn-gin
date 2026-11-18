package telemetry

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/config"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestEarliestDeviceDataAcrossTHCPNHistory(t *testing.T) {
	pg := testdb.Open(t, 0)
	mysql, dsn := testdb.MySQL(t, "earliest_"+strings.ReplaceAll(uuid.NewString(), "-", ""))
	t.Setenv("TEST_EARLIEST_THCPN_DSN", dsn)
	ctx := t.Context()
	admin := testdb.Admin(t, pg)
	device, source, temperature, humidity := uuid.New(), uuid.New(), uuid.New(), uuid.New()

	mustPlatform := func(query string, args ...any) {
		t.Helper()
		if _, err := pg.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustSource := func(query string, args ...any) {
		t.Helper()
		if _, err := mysql.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	mustPlatform(`INSERT INTO devices(id,name,device_type) VALUES($1,'Standard station','standalone')`, device)
	mustPlatform(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'THCPN test','mysql','thcpn','env:TEST_EARLIEST_THCPN_DSN',$2)`, source, admin)
	for key, id := range map[string]uuid.UUID{"temperature": temperature, "humidity": humidity} {
		mustPlatform(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,$3,$3,'telemetry',$4,'system_admin')`, id, device, key, admin)
		mustPlatform(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,payload_type,adapter_code,adapter_config_json,created_by,created_by_type) VALUES($1,$2,'columns','thcpn_legacy_mysql',$3::jsonb,$4,'system_admin')`,
			id, source, fmt.Sprintf(`{"external_device_id":42,"json_key":%q}`, key), admin)
	}

	mustSource("CREATE TABLE device_data_index(tb_name VARCHAR(64), start_at DATETIME, end_at DATETIME)")
	makeTable := func(name string) {
		mustSource("CREATE TABLE " + name + "(id BIGINT PRIMARY KEY AUTO_INCREMENT, device_id BIGINT, ts DATETIME(6), type VARCHAR(16), deleted_at DATETIME NULL, data JSON, INDEX(device_id,ts))")
	}
	for i := 1; i <= 9; i++ {
		name := fmt.Sprintf("device_data_%d", i)
		makeTable(name)
		mustSource("INSERT INTO device_data_index VALUES(?, '2026-01-01', '2026-06-30 23:59:59')", name)
	}
	makeTable("device_data_202607")
	mustSource("INSERT INTO device_data_1(device_id,ts,type,data) VALUES(42,'2026-06-01 08:00:00','data','{\"temperature\":\"invalid\"}')")
	mustSource("INSERT INTO device_data_1(device_id,ts,type,data) VALUES(42,'2026-06-10 08:00:00','data','{\"temperature\":99}')")
	// Invalid rows with the same timestamp as the first valid sample straddle a page.
	invalid := "(42,'2026-06-01 08:01:00','data','{}')"
	mustSource("INSERT INTO device_data_8(device_id,ts,type,data) VALUES " + strings.Repeat(invalid+",", 127) + invalid)
	mustSource("INSERT INTO device_data_8(device_id,ts,type,data) VALUES(42,'2026-06-01 08:01:00','data','{\"humidity\":{\"value\":0}}')")
	mustSource("INSERT INTO device_data_202607(device_id,ts,type,data) VALUES(42,'2026-07-01 00:00:00','data','{\"temperature\":21.5}')")

	svc := NewService(pg, nil, nil, config.QueryLimitsConfig{})
	chart, err := svc.QueryInternal(ctx, QueryInput{DeviceID: &device, StartTime: time.Unix(0, 0), EndTime: time.Now(), Limit: 2, Adaptive: true, TargetPoints: 2})
	if err != nil || len(chart.Series) != 2 || !strings.Contains(chart.Series[0].Error, "too many shard tables") {
		t.Fatalf("the ordinary query must still enforce its shard limit: %+v, err=%v", chart, err)
	}
	assertFirst := func(at time.Time, metric uuid.UUID, value float64) {
		t.Helper()
		result, err := svc.EarliestDeviceData(ctx, device)
		if err != nil || !result.Found || result.Timestamp == nil || !result.Timestamp.Equal(at) ||
			result.DataStreamID == nil || *result.DataStreamID != metric || result.Value == nil || *result.Value != value {
			t.Fatalf("earliest: %+v, err=%v; want %s %s %g", result, err, at, metric, value)
		}
	}
	assertFirst(time.Date(2026, 6, 1, 8, 1, 0, 0, platform.LegacySourceLocation), humidity, 0)
	mustSource("DELETE FROM device_data_8")
	mustSource("DELETE FROM device_data_1 WHERE ts >= '2026-06-10'")
	assertFirst(time.Date(2026, 7, 1, 0, 0, 0, 0, platform.LegacySourceLocation), temperature, 21.5)
	mustSource("DELETE FROM device_data_202607")
	if result, err := svc.EarliestDeviceData(ctx, device); err != nil || result.Found {
		t.Fatalf("invalid-only history should be empty: %+v, err=%v", result, err)
	}
}
