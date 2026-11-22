package deviceclassification

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
)

func TestManualInstallationMapDoesNotRequireSourceAvailability(t *testing.T) {
	db := testdb.Open(t, 0)
	id := uuid.New()
	ctx := t.Context()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'Installation','standalone')`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_profiles(device_id,latitude,longitude) VALUES($1,40.1,116.2)`, id); err != nil {
		t.Fatal(err)
	}
	called := false
	svc := NewService(db, func(context.Context, []uuid.UUID) (map[uuid.UUID]SourceLocation, error) {
		called = true
		return nil, nil
	})
	result, err := svc.Map(ctx, nil, false)
	if err != nil || len(result.Items) != 1 {
		t.Fatalf("map: %#v %v", result, err)
	}
	if called {
		t.Fatal("source lookup should be skipped for an explicit installation position")
	}
	if result.Items[0].LocationSource != "device" || result.Items[0].Latitude == nil || *result.Items[0].Latitude != 40.1 {
		t.Fatalf("installation position missing: %#v", result.Items[0])
	}
}

func TestMapKeepsGatewayAndPhysicalNodeIdentitiesSeparate(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	const gatewayAsset = "LR-82000001"
	const nodeAsset = "LR-82000002"
	const nodeSN = "FACTORY-NODE-031"
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by)
		VALUES($1,'LoRa source','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,serial_no,asset_no,device_type)
		VALUES($1,'Gateway','LEGACY-GATEWAY-SERIAL',$2,'gateway')`, gateway, gatewayAsset)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key)
		VALUES($1,$2,'lorawan_v2','UPSTREAM-GATEWAY-SN')`, gateway, source)
	must(`INSERT INTO node_profiles(device_id,node_index,name,latitude,longitude,updated_by,updated_by_type)
		VALUES($1,31,'Soil node',40.1,116.2,$2,'system_admin')`, gateway, admin)
	must(`INSERT INTO lorawan_physical_nodes(data_source_id,external_id,sn,gateway_device_id,node_index,asset_no)
		VALUES($1,31,$2,$3,31,$4)`, source, nodeSN, gateway, nodeAsset)

	result, err := NewService(db).Map(ctx, nil, true)
	if err != nil || len(result.Items) != 2 {
		t.Fatalf("map: %#v %v", result, err)
	}
	parent, child := result.Items[0], result.Items[1]
	if parent.DeviceID != gateway || parent.AssetNo != gatewayAsset || parent.NodeSN != "" {
		t.Fatalf("gateway identity: %#v", parent)
	}
	if child.GatewayDeviceID == nil || *child.GatewayDeviceID != gateway || child.NodeIndex == nil || *child.NodeIndex != 31 ||
		child.AssetNo != nodeAsset || child.NodeSN != nodeSN || child.Name != "Soil node" {
		t.Fatalf("physical node inherited gateway identity: %#v", child)
	}
	encoded, err := json.Marshal(result)
	if err != nil || strings.Contains(string(encoded), "serial_no") || strings.Contains(string(encoded), "LEGACY-GATEWAY-SERIAL") {
		t.Fatalf("map exposes legacy identity: %s %v", encoded, err)
	}
}
