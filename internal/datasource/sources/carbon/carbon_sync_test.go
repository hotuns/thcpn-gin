package carbon

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"testing"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestCarbonSyncConfigSnapshot(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:NOT_USED',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	q := sqlc.New(db)
	svc := newTestService(db)
	var deviceID uuid.UUID
	for i := 0; i < 2; i++ {
		tx, err := db.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		result, err := svc.ApplySyncedDevice(ctx, q.WithTx(tx), sqlc.DataSource{ID: source}, CarbonDevice{ID: 1, Name: "Carbon station", SN: "carbon-test", NodesCount: 16}, nil, CarbonDeviceConfig{ID: 1, Data: json.RawMessage(`[]`), Image: json.RawMessage(`[]`), Control: json.RawMessage(`{}`)}, admin)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("carbon sync attempt %d: %v", i+1, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			deviceID = result.Device.ID
		} else if result.Device.ID != deviceID {
			t.Fatal("retry created a duplicate platform device")
		}
	}
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM device_config_snapshots WHERE device_id=$1 AND adapter_code='carbon_sink_mysql'`, deviceID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("expected one carbon snapshot after retry, got %d: %v", count, err)
	}
}
func TestCarbonSnapshotMigrationRoundTrip(t *testing.T) {
	db := testdb.Open(t, 43)
	_, file, _, _ := runtime.Caller(0)
	dir := filepath.Join(filepath.Dir(file), "../../../../migrations")
	up := filepath.Join(dir, "000044_carbon_config_snapshots.up.sql")
	down := filepath.Join(dir, "000044_carbon_config_snapshots.down.sql")
	check := func(want bool) {
		t.Helper()
		var expression string
		if err := db.QueryRow(t.Context(), `SELECT pg_get_expr(conbin,conrelid) FROM pg_constraint WHERE conrelid='device_config_snapshots'::regclass AND conname='device_config_snapshots_adapter_code_check'`).Scan(&expression); err != nil {
			t.Fatal(err)
		}
		for adapter, accepted := range map[string]bool{"carbon_sink_mysql": want, "thcpn_legacy_mysql": true, "unknown": false} {
			var got bool
			if err := db.QueryRow(t.Context(), `SELECT `+expression+` FROM (SELECT $1::text AS adapter_code) AS candidate`, adapter).Scan(&got); err != nil || got != accepted {
				t.Fatalf("adapter %s accepted=%v, want %v: %v", adapter, got, accepted, err)
			}
		}
	}
	check(false)
	testdb.Apply(t, db, up)
	check(true)
	testdb.Apply(t, db, down)
	check(false)
	testdb.Apply(t, db, up)
	check(true)
}
