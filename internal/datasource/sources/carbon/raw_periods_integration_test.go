package carbon

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/observation"
	"thcpn-gin/internal/testdb"
)

func TestCarbonRawPeriodDiscoveryAndHistoricalSamples(t *testing.T) {
	mysql, dsn := testdb.MySQL(t, carbonDatabaseName)
	pg := testdb.Open(t, 0)
	ctx := t.Context()
	actor, source, deviceID := testdb.Admin(t, pg), uuid.New(), uuid.New()
	t.Setenv("TEST_CARBON_RAW_EXPORT_DSN", dsn)
	for _, table := range []string{"device_data_next_202408", "device_data_next_202409", "device_data_next_202410"} {
		_, err := mysql.ExecContext(ctx, "CREATE TABLE `"+table+"` (device_id BIGINT, node_id INT, period VARCHAR(100), period_at DATETIME(6), field VARCHAR(20), type VARCHAR(20), room VARCHAR(20), ts DATETIME(6), data JSON, deleted_at DATETIME)")
		if err != nil {
			t.Fatal(err)
		}
	}
	at := time.Date(2024, 9, 30, 23, 59, 0, 0, CarbonLocation)
	for _, sample := range []struct {
		table, room, field string
		at                 time.Time
		value              int
	}{
		{"202409", "light", "A", at, 400},
		{"202409", "light", "A", at.Add(time.Second), 401},
		{"202410", "black", "A", at.Add(time.Minute), 450},
		{"202410", "black", "B", at.Add(time.Minute), 460},
	} {
		_, err := mysql.ExecContext(ctx, "INSERT INTO `device_data_next_"+sample.table+"` VALUES (13,1,'2024-cycle',?,?,'data',?,?,JSON_ARRAY(JSON_OBJECT('key','CO2','data',?)),NULL)", at.Format("2006-01-02 15:04:05"), sample.field, sample.room, sample.at.Format("2006-01-02 15:04:05"), sample.value)
		if err != nil {
			t.Fatal(err)
		}
	}
	// Discovery of raw cycles must not touch derived flux tables.
	if _, err := mysql.ExecContext(ctx, "CREATE TABLE carbon_flux_202409 (unrelated INT)"); err != nil {
		t.Fatal(err)
	}
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := pg.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon raw export','mysql','carbon','env:TEST_CARBON_RAW_EXPORT_DSN',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Carbon raw station','carbon_sink')`, deviceID)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','13')`, deviceID, source)
	service := newTestService(pg)
	summaries, err := service.CarbonRawPeriods(ctx, deviceID, 1, at.Add(-time.Hour), at.Add(time.Hour))
	if err != nil || len(summaries) != 1 || len(summaries[0].Fields) != 2 {
		t.Fatalf("cycle not deduplicated before loading samples: %+v %v", summaries, err)
	}
	phases, err := service.CarbonRawPeriodSamples(ctx, deviceID, 1, "A", summaries[0])
	if err != nil {
		t.Fatalf("historical cycle should route by PeriodAt, independent of today's date: %v", err)
	}
	if len(phases) != 2 || phases[0].Room != "light" || phases[0].Samples != 2 || phases[1].Room != "black" || phases[1].Samples != 1 || *phases[1].Points[0].CO2 != 450 {
		t.Fatalf("cross-month samples missing or mixed with field B: %+v", phases)
	}
	if _, err := mysql.ExecContext(ctx, "CREATE TABLE carbon_flux_202410(period VARCHAR(100),period_at DATETIME(6),device_id BIGINT,node_id INT,data JSON,deleted_at DATETIME)"); err != nil {
		t.Fatal(err)
	}
	if _, err := mysql.ExecContext(ctx, "INSERT INTO carbon_flux_202410 VALUES('2024-cycle',?,13,1,JSON_ARRAY(JSON_OBJECT('field','A')),NULL)", at.Format("2006-01-02 15:04:05")); err != nil {
		t.Fatal(err)
	}
	_, sourceDB, err := service.openCarbonDeviceSource(ctx, deviceID)
	if err != nil {
		t.Fatal(err)
	}
	fluxFields, err := queryCarbonFluxFields(ctx, sourceDB, []string{"carbon_flux_202410"}, 13, 1, at, at.Add(time.Minute))
	if err != nil || len(fluxFields["2024-cycle"]) != 1 || fluxFields["2024-cycle"][0] != "A" {
		t.Fatalf("per-shard DISTINCT flux JSON query failed: %+v %v", fluxFields, err)
	}
	must(`INSERT INTO device_observation_starts(device_id,node_index,starts_at,updated_by) VALUES($1,1,$2,$3)`, deviceID, at.Add(time.Second), actor)
	if _, err := service.CarbonRawPeriodSamples(ctx, deviceID, 1, "A", summaries[0]); apperr.KindOf(err) != apperr.KindNotFound {
		t.Fatalf("raw export bypassed formal observation cutoff: %v", err)
	}
	if _, err := service.CarbonRawPeriodSamples(observation.WithPhase(ctx, observation.All), deviceID, 1, "A", summaries[0]); err != nil {
		t.Fatalf("administrator all-data query lost historical access: %v", err)
	}
}
