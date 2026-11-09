package lorawanv2

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/testdb"
)

func TestPhysicalNodeRefreshPreservesPositionAndAssetIdentity(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Validate the new migration round trip before inserting inventory.
	testdb.Apply(t, db, "../../../../migrations/000057_asset_numbers.down.sql")
	testdb.Apply(t, db, "../../../../migrations/000048_lorawan_physical_nodes.down.sql")
	testdb.Apply(t, db, "../../../../migrations/000048_lorawan_physical_nodes.up.sql")
	testdb.Apply(t, db, "../../../../migrations/000057_asset_numbers.up.sql")
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, gateway)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	must(`INSERT INTO node_profiles(device_id,node_index,name,latitude,longitude,updated_by,updated_by_type) VALUES($1,3,'样地三',30,120,$2,'system_admin')`, gateway, actor)
	current := `[{"id":10,"sn":"NODE-A","gateway_sn":"GW","node_index":3}]`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && r.URL.Path == "/nodes" {
			var input map[string]string
			if json.NewDecoder(r.Body).Decode(&input) != nil || input["sn"] != "UNBOUND" {
				t.Error("invalid registry body")
			}
			fmt.Fprint(w, `{"success":true,"payload":{"id":12,"sn":"UNBOUND","gateway_sn":null,"node_index":null}}`)
			return
		}
		if r.Method != "GET" || r.URL.Path != "/device/GW/nodes" {
			t.Errorf("unexpected registry request: %s", r.URL.Path)
			w.WriteHeader(500)
			return
		}
		fmt.Fprintf(w, `{"success":true,"payload":{"gateway_sn":"GW","bound_node_count":%d,"data":%s}}`, func() int {
			if current == "[]" {
				return 0
			}
			return 1
		}(), current)
	}))
	defer server.Close()
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	refresh := func() {
		t.Helper()
		if _, err := s.SyncPhysicalNodes(ctx, gateway); err != nil {
			t.Fatal(err)
		}
	}
	registered, err := s.OperatePhysicalNode(ctx, gateway, actor, PhysicalNodeCommand{Action: "register", SN: "UNBOUND"})
	if err != nil || registered.Status != "completed" {
		t.Fatalf("register: %+v %v", registered, err)
	}
	var unbound bool
	var registeredAsset string
	var hardwareSN *string
	if err := db.QueryRow(ctx, `SELECT gateway_device_id IS NULL AND node_index IS NULL,asset_no,hardware_sn FROM lorawan_physical_nodes WHERE sn='UNBOUND'`).Scan(&unbound, &registeredAsset, &hardwareSN); err != nil || !unbound || !strings.HasPrefix(registeredAsset, "LR-") || hardwareSN != nil {
		t.Fatal("registered asset not persisted independently")
	}
	if _, err := s.OperatePhysicalNode(ctx, gateway, actor, PhysicalNodeCommand{Action: "bind", SN: "UNBOUND", NodeIndex: 255}); err == nil {
		t.Fatal("invalid index accepted")
	}
	refresh()
	var oldID uuid.UUID
	if err := db.QueryRow(ctx, `SELECT id FROM lorawan_physical_nodes WHERE sn='NODE-A'`).Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	nodes, err := device.NewService(db).ListGatewayNodes(ctx, gateway)
	if err != nil || len(nodes) != 1 || nodes[0].Name != "样地三" || nodes[0].NodeSN != "NODE-A" || *nodes[0].Target.NodeIndex != 3 {
		t.Fatalf("sparse bindings generated phantom nodes: %+v %v", nodes, err)
	}
	key, originalAsset := nodes[0].Key, nodes[0].AssetNo
	if !strings.HasPrefix(originalAsset, "LR-") {
		t.Fatal("bound node lacks an asset number")
	}
	projected, err := s.ProjectNodeAssets(ctx, source, json.RawMessage(`{"data":[{"id":10,"sn":"NODE-A","gateway_sn":"GW","node_index":3},{"id":99,"sn":"INVENTORY-ONLY"}],"pagination":{"total":2}}`))
	if err != nil || !strings.Contains(string(projected), originalAsset) {
		t.Fatalf("inventory projection lost asset number: %v", err)
	}
	var inventoryAsset string
	if err := db.QueryRow(ctx, `SELECT asset_no FROM lorawan_physical_nodes WHERE external_id=99`).Scan(&inventoryAsset); err != nil || !strings.HasPrefix(inventoryAsset, "LR-") {
		t.Fatalf("inventory-only node has no asset number: %v", err)
	}
	current = `[{"id":11,"sn":"NODE-B","gateway_sn":"GW","node_index":3}]`
	refresh()
	nodes, err = device.NewService(db).ListGatewayNodes(ctx, gateway)
	if err != nil || nodes[0].Key != key || nodes[0].Name != "样地三" || nodes[0].NodeSN != "NODE-B" || nodes[0].AssetNo == originalAsset || !strings.HasPrefix(nodes[0].AssetNo, "LR-") || *nodes[0].Latitude != 30 {
		t.Fatalf("replacement changed position: %+v %v", nodes, err)
	}
	var id uuid.UUID
	var bound bool
	var oldAsset string
	if err := db.QueryRow(ctx, `SELECT id,gateway_device_id IS NOT NULL,asset_no FROM lorawan_physical_nodes WHERE sn='NODE-A'`).Scan(&id, &bound, &oldAsset); err != nil || id != oldID || bound || oldAsset != originalAsset {
		t.Fatal("old physical asset lost or still bound")
	}
	current = "[]"
	refresh()
	nodes, err = device.NewService(db).ListGatewayNodes(ctx, gateway)
	if err != nil || len(nodes) != 1 || nodes[0].Bound || nodes[0].Key != key {
		t.Fatalf("unbinding deleted historical position: %+v %v", nodes, err)
	}
	current = `[{"id":13,"sn":"NODE-C","gateway_sn":"GW","node_index":3}]`
	refresh()
	restored, restoreErr := device.NewService(db).ListGatewayNodesInScope(ctx, gateway, "bound")
	if restoreErr != nil || len(restored) != 1 || restored[0].Key != key || restored[0].Name != "样地三" || restored[0].NodeSN != "NODE-C" || *restored[0].Latitude != 30 {
		t.Fatalf("rebinding lost node data: %+v %v", restored, restoreErr)
	}
	current = "[]"
	refresh()
	asset, err := device.NewService(db).GetAsset(ctx, gateway)
	if err != nil || asset.ChildCount != 0 {
		t.Fatal("count must reflect actual binding count")
	}
}
