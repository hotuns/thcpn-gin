package datasource

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
)

func TestTHCPNSyncPreservesPlatformNodeName(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, node := uuid.New(), uuid.New()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'THCPN','mysql','thcpn','env:NOT_USED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'林下观测','gateway_node')`, node)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'thcpn_legacy_mysql','42')`, node, source)
	q := sqlc.New(db)
	svc := &Service{db: db, queries: q}
	result, _, created, err := svc.upsertTHCPNPlatformDevice(ctx, q, sqlc.DataSource{ID: source}, thcpnDeviceSyncInput{ExternalDeviceID: 42, DeviceType: "gateway_node"}, thcpnExternalDevice{THCPNExternalDeviceMetadata: THCPNExternalDeviceMetadata{Name: "源端旧名称"}})
	if err != nil || created || result.ID != node || result.Name != "林下观测" {
		t.Fatalf("sync replaced platform name: %+v %v", result, err)
	}
}
