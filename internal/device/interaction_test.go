package device

import (
	"github.com/google/uuid"
	"testing"
	"thcpn-gin/internal/testdb"
)

func TestGatewayNodeTargetsKeepIdentityWithoutTelemetry(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, gateway, secondGateway := uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES ($1,'LoRa','http_api','lorawan_v2','env:NOT_USED',$2)`, source, admin)
	for _, id := range []uuid.UUID{gateway, secondGateway} {
		must(`INSERT INTO devices(id,name,device_type,product_id) VALUES ($1,'Gateway','gateway','unrelated_product')`, id)
		must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES ($1,$2,'lorawan_v2',$3)`, id, source, id.String())
		must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES ($1,'lorawan_v2_nodes_count','Nodes','number','2',$2,$2)`, id, admin)
	}
	svc := NewService(db)
	item, err := svc.GetAsset(ctx, gateway)
	if err != nil {
		t.Fatal(err)
	}
	if item.SourceFamily != "lorawan_v2" || item.ChildCount != 2 {
		t.Fatalf("source identity not independent of product: %#v", item)
	}
	nodes, err := svc.ListGatewayNodes(ctx, gateway)
	if err != nil {
		t.Fatal(err)
	}
	other, err := svc.ListGatewayNodes(ctx, secondGateway)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 2 || len(nodes[0].Streams) != 0 || nodes[0].Target.DeviceID != nil || *nodes[0].Target.GatewayDeviceID != gateway || *nodes[0].Target.NodeIndex != 1 || nodes[0].Key == other[0].Key {
		t.Fatalf("incorrect indexed identity: %#v", nodes)
	}
	// A second management source must not silently replace the first one.
	if _, err := db.Exec(ctx, `INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES ($1,$2,'thcpn_legacy_mysql','41')`, gateway, source); err == nil {
		t.Fatal("accepted ambiguous active management source")
	}
}

func TestNodeTargetKeyIncludesGatewayIdentity(t *testing.T) {
	index := 1
	first, second := uuid.New(), uuid.New()
	a := NodeTarget{Kind: "gateway_node", GatewayDeviceID: &first, NodeIndex: &index}
	b := NodeTarget{Kind: "gateway_node", GatewayDeviceID: &second, NodeIndex: &index}
	if a.Key() == b.Key() {
		t.Fatal("node index leaked across gateways")
	}
}
