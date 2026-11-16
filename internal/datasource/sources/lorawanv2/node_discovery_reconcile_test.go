package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/device"
	"thcpn-gin/internal/testdb"
)

func TestDiscoveredNodesProjectOnlyBoundNodesAndRetryMissingConfiguration(t *testing.T) {
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
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'automatic','http_api','lorawan_v2','secret:test',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'现场网关','gateway')`, gateway)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	// Old empty profile slots are not actual nodes and must never trigger requests.
	must(`INSERT INTO node_profiles(device_id,node_index,name,latitude,longitude,updated_by,updated_by_type)
		SELECT $1,n,'样地 '||n,30,120,$2,'system_admin' FROM generate_series(1,254) n`, gateway, actor)
	var mu sync.Mutex
	current := `[{"id":3,"sn":"NODE-3","gateway_sn":"GW","node_index":3},{"id":100,"sn":"NODE-100","gateway_sn":"GW","node_index":100}]`
	missing100, missing3, fail3, failDirectory := true, false, false, false
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		requests = append(requests, r.Method+" "+r.URL.Path)
		if r.Method != http.MethodGet {
			t.Errorf("automatic discovery must not mutate source: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
			return
		}
		switch r.URL.Path {
		case "/device/GW/nodes":
			if failDirectory {
				w.WriteHeader(503)
				return
			}
			var data []json.RawMessage
			_ = json.Unmarshal([]byte(current), &data)
			fmt.Fprintf(w, `{"success":true,"payload":{"gateway_sn":"GW","bound_node_count":%d,"data":%s}}`, len(data), current)
		case "/device/GW":
			fmt.Fprint(w, `{"success":true,"payload":{"sn":"GW","node_count":254}}`)
		case "/device/GW/node/3/sensor_config/latest":
			if fail3 {
				w.WriteHeader(503)
				return
			}
			if missing3 {
				w.WriteHeader(404)
				fmt.Fprint(w, `{"success":false,"error_code":"0x10011307"}`)
				return
			}
			fmt.Fprint(w, `{"success":true,"payload":{"id":3,"content":[["ad",[["temp","1,0","C"]],1]]}}`)
		case "/device/GW/node/55/sensor_config/latest":
			fmt.Fprint(w, `{"success":true,"payload":{"id":55,"content":[["ad",[["legacy_temp","1,0","C"]],1]]}}`)
		case "/device/GW/node/100/sensor_config/latest":
			if missing100 {
				w.WriteHeader(404)
				fmt.Fprint(w, `{"success":false,"error_code":"0x10011307"}`)
				return
			}
			fmt.Fprint(w, `{"success":true,"payload":{"id":100,"content":[["ad",[["humidity","1,0","%"]],1]]}}`)
		default:
			t.Errorf("unexpected request to capacity slot or gateway data: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	refresh := func() {
		t.Helper()
		if _, err := s.RefreshDiscoveredNodes(ctx, gateway); err != nil {
			t.Fatal(err)
		}
	}
	refresh()
	visible, err := device.NewService(db).ListGatewayNodesInScope(ctx, gateway, "bound")
	if err != nil || len(visible) != 2 || *visible[0].Target.NodeIndex != 3 || *visible[1].Target.NodeIndex != 100 {
		t.Fatalf("only source-bound nodes should appear: %+v %v", visible, err)
	}
	if visible[0].Name != "样地 3" || visible[0].NodeSN != "NODE-3" || *visible[0].Latitude != 30 {
		t.Fatalf("platform profile was changed: %+v", visible[0])
	}
	var originalID uuid.UUID
	var originalUpdated, originalBindingTime time.Time
	if err := db.QueryRow(ctx, `SELECT id,updated_at FROM data_streams WHERE device_id=$1 AND code='lora_node_3_temp'`, gateway).Scan(&originalID, &originalUpdated); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(ctx, `SELECT synced_at FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND node_index=3`, gateway).Scan(&originalBindingTime); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1 AND code LIKE 'lora_node_100_%' AND purpose='status'`, gateway).Scan(&count); err != nil || count != 4 {
		t.Fatalf("missing configuration must still expose runtime streams: count=%d err=%v", count, err)
	}
	mu.Lock()
	requests = nil
	mu.Unlock()
	refresh()
	mu.Lock()
	if strings.Contains(strings.Join(requests, ","), "/node/3/") {
		t.Errorf("unchanged complete node unnecessarily scanned: %v", requests)
	}
	if !strings.Contains(strings.Join(requests, ","), "/node/100/") {
		t.Errorf("missing configuration was not retried: %v", requests)
	}
	missing100 = false
	mu.Unlock()
	refresh()
	if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1 AND code='lora_node_100_humidity' AND purpose='measurement'`, gateway).Scan(&count); err != nil || count != 1 {
		t.Fatalf("late configuration was not projected: %d %v", count, err)
	}
	// A direct directory refresh must not make every unchanged binding dirty.
	if _, err := s.SyncPhysicalNodes(ctx, gateway); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	requests = nil
	mu.Unlock()
	refresh()
	mu.Lock()
	if len(requests) != 1 || requests[0] != "GET /device/GW/nodes" {
		t.Errorf("complete gateway should only read its directory: %v", requests)
	}
	mu.Unlock()
	var id uuid.UUID
	var updated, boundTime time.Time
	if err := db.QueryRow(ctx, `SELECT id,updated_at FROM data_streams WHERE device_id=$1 AND code='lora_node_3_temp'`, gateway).Scan(&id, &updated); err != nil || id != originalID || !updated.Equal(originalUpdated) {
		t.Fatalf("unchanged streams rewritten: %s %v %v", id, updated, err)
	}
	if err := db.QueryRow(ctx, `SELECT synced_at FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND node_index=3`, gateway).Scan(&boundTime); err != nil || !boundTime.Equal(originalBindingTime) {
		t.Fatalf("unchanged binding timestamp moved: %v %v", boundTime, err)
	}
	mu.Lock()
	current = `[{"id":4,"sn":"REPLACEMENT-3","gateway_sn":"GW","node_index":3},{"id":100,"sn":"NODE-100","gateway_sn":"GW","node_index":100}]`
	fail3 = true
	mu.Unlock()
	if _, err := s.RefreshDiscoveredNodes(ctx, gateway); err == nil {
		t.Fatal("configuration read failure was swallowed")
	}
	mu.Lock()
	fail3, missing3, requests = false, true, nil
	mu.Unlock()
	refresh()
	mu.Lock()
	if !strings.Contains(strings.Join(requests, ","), "/node/3/") {
		t.Errorf("failed replacement projection was not retried: %v", requests)
	}
	missing3, requests = false, nil
	mu.Unlock()
	refresh()
	mu.Lock()
	if !strings.Contains(strings.Join(requests, ","), "/node/3/") {
		t.Errorf("configuration arriving after diagnostics was not retried: %v", requests)
	}
	current = `[{"id":4,"sn":"REPLACEMENT-3","gateway_sn":"GW","node_index":3}]`
	mu.Unlock()
	refresh()
	visible, err = device.NewService(db).ListGatewayNodesInScope(ctx, gateway, "bound")
	if err != nil || len(visible) != 1 || visible[0].NodeSN != "REPLACEMENT-3" || visible[0].Name != "样地 3" {
		t.Fatalf("replacement/unbind not reflected: %+v %v", visible, err)
	}
	if err := db.QueryRow(ctx, `SELECT id FROM data_streams WHERE device_id=$1 AND code='lora_node_3_temp'`, gateway).Scan(&id); err != nil || id != originalID {
		t.Fatalf("replacement changed historical stream identity: %s %v", id, err)
	}
	if err := db.QueryRow(ctx, `SELECT count(*) FROM data_streams WHERE device_id=$1 AND code='lora_node_100_humidity'`, gateway).Scan(&count); err != nil || count != 1 {
		t.Fatal("unbind removed historical stream")
	}
	mu.Lock()
	failDirectory = true
	mu.Unlock()
	if _, err := s.RefreshDiscoveredNodes(ctx, gateway); err == nil {
		t.Fatal("unavailable directory not reported")
	}
	visible, err = device.NewService(db).ListGatewayNodesInScope(ctx, gateway, "bound")
	if err != nil || len(visible) != 1 || visible[0].NodeSN != "REPLACEMENT-3" {
		t.Fatal("failed upstream read cleared cached bindings")
	}

	// An operator-approved legacy position gets streams but no invented SN.
	must(`INSERT INTO lorawan_legacy_nodes(gateway_device_id,node_index) VALUES($1,55)`, gateway)
	mu.Lock()
	failDirectory, requests = false, nil
	mu.Unlock()
	refresh()
	visible, err = device.NewService(db).ListGatewayNodesInScope(ctx, gateway, "bound")
	if err != nil || len(visible) != 2 || !visible[1].IndexedOnly || visible[1].NodeSN != "" || len(visible[1].Streams) != 5 {
		t.Fatalf("explicit legacy position was not projected with runtime and sensor metrics: %+v %v", visible, err)
	}
	mu.Lock()
	defer mu.Unlock()
	if !strings.Contains(strings.Join(requests, ","), "/node/55/") {
		t.Errorf("did not read the explicit legacy position's configuration: %v", requests)
	}
}

func TestDiscoveryScanContinuesAfterGatewayFailureAndSkipsInactive(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	actor := testdb.Admin(t, db)
	source := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'automatic','http_api','lorawan_v2','secret:test',$2)`, source, actor); err != nil {
		t.Fatal(err)
	}
	for i, sn := range []string{"BAD", "GOOD", "INACTIVE", "RETIRED"} {
		id := uuid.MustParse(fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1))
		status := "active"
		if sn == "INACTIVE" {
			status = "disabled"
		}
		if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type,status) VALUES($1,$2,'gateway',$3)`, id, sn, status); err != nil {
			t.Fatal(err)
		}
		if sn == "RETIRED" {
			if _, err := db.Exec(ctx, `UPDATE devices SET lifecycle_status='retired' WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := db.Exec(ctx, `INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2',$3)`, id, source, sn); err != nil {
			t.Fatal(err)
		}
	}
	var goodRead atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/device/BAD/nodes":
			w.WriteHeader(503)
		case "/device/GOOD/nodes":
			goodRead.Store(true)
			fmt.Fprint(w, `{"success":true,"payload":{"gateway_sn":"GOOD","bound_node_count":0,"data":[]}}`)
		default:
			t.Errorf("inactive or unrelated device requested: %s", r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	result, err := s.ReconcileDiscoveredNodes(ctx)
	if err == nil || result.Gateways != 2 || result.Failed != 1 || !goodRead.Load() {
		t.Fatalf("scan failed to isolate gateway failure: %+v %v good=%v", result, err, goodRead.Load())
	}
}
