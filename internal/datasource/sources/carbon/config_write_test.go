package carbon

import (
	"testing"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestUpdateDeviceConfigOnlyCreatesChangedCarbonVersion(t *testing.T) {
	mysql, dsn := testdb.MySQL(t, carbonDatabaseName)
	ctx := t.Context()
	if _, err := mysql.ExecContext(ctx, `CREATE TABLE device_configs(id BIGINT PRIMARY KEY AUTO_INCREMENT,device_id BIGINT NOT NULL,data JSON,image JSON,control JSON,misc JSON,created_at DATETIME,updated_at DATETIME,deleted_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	if _, err := mysql.ExecContext(ctx, `INSERT INTO device_configs(id,device_id,data,image,control,misc) VALUES(7,42,'[]','[]','{"a":1,"b":2}','{"firmware":true}')`); err != nil {
		t.Fatal(err)
	}
	pg := testdb.Open(t, 0)
	actor, source, device := testdb.Admin(t, pg), uuid.New(), uuid.New()
	t.Setenv("TEST_CARBON_CONFIG_DSN", dsn)
	if _, err := pg.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon config','mysql','carbon','env:TEST_CARBON_CONFIG_DSN',$2)`, source, actor); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Carbon config','carbon_sink')`, device); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.Exec(ctx, `INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','42')`, device, source); err != nil {
		t.Fatal(err)
	}
	svc := newTestService(pg)
	input := platform.UpdateDeviceConfigInput{DeviceID: device, ActorUserID: actor, ExpectedConfigID: 7, DataJSON: []byte("[]"), ImageJSON: []byte("[]"), ControlJSON: []byte(`{ "b": 2, "a": 1 }`)}
	unchanged, err := svc.UpdateDeviceConfig(ctx, input)
	if err != nil || unchanged.Config.ID != 7 || unchanged.WriteState == nil || unchanged.WriteState.Source != "unchanged" || unchanged.WriteState.Device != "not_sent" {
		t.Fatalf("equivalent settings created a revision: %+v %v", unchanged, err)
	}
	input.ControlJSON = []byte(`{"a":1,"b":3}`)
	updated, err := svc.UpdateDeviceConfig(ctx, input)
	if err != nil || updated.Config.ID <= 7 || updated.WriteState == nil || updated.WriteState.Source != "accepted" || updated.WriteState.Platform != "synced" {
		t.Fatalf("changed settings did not apply: %+v %v", updated, err)
	}
	var count int
	if err := mysql.QueryRowContext(ctx, `SELECT COUNT(*) FROM device_configs WHERE device_id=42`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("expected only the initial version and one actual change, got %d: %v", count, err)
	}
}
