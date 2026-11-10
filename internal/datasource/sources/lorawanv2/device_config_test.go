package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDeviceConfigPathsAndPartialSnapshotFailure(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	var requests atomic.Int32
	var lastPath atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		lastPath.Store(r.URL.Path)
		if r.URL.Query().Get("node_index") != "" || r.URL.Query().Get("latest") != "" {
			t.Error("platform target options leaked into upstream query")
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/sensor_config/latest") {
			w.WriteHeader(http.StatusNotFound)
			fmt.Fprint(w, `{"success":false,"error_code":"0x10011307"}`)
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"payload":{"id":42}}`))
	}))
	defer server.Close()
	s, _, id, admin := nodeConfigTestService(t, db, server.URL)
	request := ConfigRequest{DeviceID: id, ActorID: admin, Method: http.MethodGet, Kind: "gateway", Query: url.Values{"page": {"1"}}}
	if _, err := s.ConfigureDevice(ctx, request); err != nil || lastPath.Load() != "/device/GW-1/configs" {
		t.Fatalf("gateway read path=%v: %v", lastPath.Load(), err)
	}
	request.Kind = "time"
	request.NodeIndex = 1
	request.Latest = true
	if _, err := s.ConfigureDevice(ctx, request); err != nil || lastPath.Load() != "/device/GW-1/node/1/time_config/latest" {
		t.Fatalf("node read path=%v: %v", lastPath.Load(), err)
	}
	request.Method = http.MethodPost
	request.Body = map[string]any{"content": []any{}}
	if result, err := s.ConfigureDevice(ctx, request); err != nil || result.WriteState == nil || result.WriteState.Source != "accepted" || result.WriteState.Device != "unknown" {
		t.Fatalf("time write: %+v %v", result, err)
	}
	before := requests.Load()
	request.NodeIndex = 255
	if _, err := s.ConfigureDevice(ctx, request); err == nil || requests.Load() != before {
		t.Fatal("out-of-range node reached source API")
	}
	if _, err := db.Exec(ctx, `ALTER TABLE lorawan_v2_node_config_snapshots ADD CONSTRAINT reject_test_snapshot CHECK(node_index<0) NOT VALID`); err != nil {
		t.Fatal(err)
	}
	request.NodeIndex = 1
	request.Kind = "sensor"
	request.Body = map[string]any{"mode": "advanced", "wait_time": 60, "content": []any{[]any{"iic", []any{"SHT30", "0x44", []any{"humidity"}}}}, "metrics": []any{map[string]any{"key": "humidity", "name": "湿度"}}}
	result, err := s.ConfigureDevice(ctx, request)
	if err != nil || result.WriteState == nil || result.WriteState.Source != "accepted" || result.WriteState.Platform != "failed" || result.Status != "partial" || len(result.Warnings) == 0 {
		t.Fatalf("lost partial result: %+v %v", result, err)
	}
	if requests.Load() != before+2 {
		t.Fatal("expected a latest read and a single source write, without another sync after snapshot failure")
	}
	op, err := s.GetSourceOperation(ctx, result.WriteState.OperationID)
	if err != nil || op.Status != "partial" {
		t.Fatalf("partial operation: %+v %v", op, err)
	}
}

func nodeConfigTestService(t *testing.T, db *pgxpool.Pool, baseURL string) (*Service, uuid.UUID, uuid.UUID, uuid.UUID) {
	t.Helper()
	admin := testdb.Admin(t, db)
	source, id := uuid.New(), uuid.New()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, []any{id}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW-1')`, []any{id, source}},
		{`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','1',$2,$2)`, []any{id, admin}},
	} {
		if _, err := db.Exec(t.Context(), stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": baseURL, "username": "reader", "password": "test-secret"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	return s, source, id, admin
}

func TestNodeSensorSaveOnlyWritesNativeChanges(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	protocol := func(key string, port int) []any {
		return []any{[]any{"ad", []any{[]any{key, "1,0", "V"}}, port}}
	}
	native := map[int]nativeSensorConfig{
		1: {ID: 11, WaitTime: 20, Content: protocol("v", 1)},
		2: {ID: 12, WaitTime: 90, Content: protocol("v", 2)},
		3: {ID: 13, WaitTime: 30, Content: protocol("other", 1)},
	}
	var mu sync.Mutex
	var posts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/device/GW-1" {
			fmt.Fprint(w, `{"success":true,"payload":{"sn":"GW-1","node_count":5}}`)
			return
		}
		path := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(path) < 5 || path[2] != "node" || path[4] != "sensor_config" {
			t.Errorf("unexpected source request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		index, _ := strconv.Atoi(path[3])
		mu.Lock()
		defer mu.Unlock()
		current, exists := native[index]
		switch r.Method {
		case http.MethodGet:
			if index == 5 {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if !exists {
				w.WriteHeader(http.StatusNotFound)
				fmt.Fprint(w, `{"success":false,"error_code":"0x10011307"}`)
				return
			}
		case http.MethodPost:
			var proposed nativeSensorConfig
			if err := json.NewDecoder(r.Body).Decode(&proposed); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			proposed.ID = int64(posts.Add(1)) + 100
			current, native[index] = proposed, proposed
		default:
			t.Errorf("unexpected method: %s", r.Method)
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": current})
	}))
	defer server.Close()
	s, source, device, admin := nodeConfigTestService(t, db, server.URL)
	if err := s.syncLoRaWANV2Node(ctx, SyncLoRaWANV2GatewayInput{DataSourceID: source, GatewaySN: "GW-1", ActorUserID: admin}, 1); err != nil {
		t.Fatal(err)
	}
	var streamBefore uuid.UUID
	if err := db.QueryRow(ctx, `SELECT id FROM data_streams WHERE device_id=$1 AND code='lora_node_1_v'`, device).Scan(&streamBefore); err != nil {
		t.Fatal(err)
	}
	metrics := []any{map[string]any{"key": "v", "name": "地表电压", "unit": "V"}}
	metricsOnly := map[string]any{"mode": "metrics", "metrics": metrics}
	advanced := func(wait, port int) map[string]any {
		return map[string]any{"mode": "advanced", "wait_time": wait, "content": protocol("v", port), "metrics": metrics}
	}
	save := func(index int, body any) (ConfigResult, error) {
		return s.ConfigureDevice(ctx, ConfigRequest{DeviceID: device, ActorID: admin, Kind: "sensor", NodeIndex: index, Method: http.MethodPost, Body: body})
	}
	assertSave := func(index int, body any, wantSource string, wantPosts int32) {
		t.Helper()
		result, err := save(index, body)
		if err != nil || result.WriteState == nil || result.WriteState.Source != wantSource || result.WriteState.Platform != "synced" || posts.Load() != wantPosts {
			t.Fatalf("node %d: state=%+v warnings=%+v writes=%d err=%v", index, result.WriteState, result.Warnings, posts.Load(), err)
		}
		if wantSource == "unchanged" && result.WriteState.Device != "not_sent" {
			t.Fatalf("node %d: source was unchanged but device state was %s", index, result.WriteState.Device)
		}
	}
	assertSave(1, metricsOnly, "unchanged", 0)
	assertSave(2, metricsOnly, "unchanged", 0) // Different port and wait time are preserved.
	assertSave(1, advanced(20, 1), "unchanged", 0)
	for _, index := range []int{1, 2} {
		read, err := s.ConfigureDevice(ctx, ConfigRequest{DeviceID: device, ActorID: admin, Kind: "sensor", NodeIndex: index, Method: http.MethodGet, Latest: true})
		var current struct {
			nativeSensorConfig
			Metrics []loraWANV2MetricSemantic `json:"metrics"`
		}
		originalWait := map[int]int{1: 20, 2: 90}[index]
		if err != nil || json.Unmarshal(read.Payload, &current) != nil || current.ID != int64(index+10) || !current.sameSettings(nativeSensorConfig{Content: protocol("v", index), WaitTime: originalWait}) || len(current.Metrics) != 1 || current.Metrics[0].Name != "地表电压" {
			t.Fatalf("node %d lost metadata or changed upstream version: %s err=%v", index, read.Payload, err)
		}
	}
	var streamAfter uuid.UUID
	var name string
	if err := db.QueryRow(ctx, `SELECT id,name FROM data_streams WHERE device_id=$1 AND code='lora_node_1_v'`, device).Scan(&streamAfter, &name); err != nil || streamAfter != streamBefore || name != "地表电压" {
		t.Fatalf("platform stream not renamed in place: %s %s err=%v", streamAfter, name, err)
	}
	if _, sent, err := s.SaveNativeSensorConfig(ctx, source, "/device/GW-1/node/2/sensor_config", nativeSensorConfig{WaitTime: 90, Content: protocol("v", 2)}); err != nil || sent {
		t.Fatalf("source console duplicated an unchanged native configuration: sent=%v err=%v", sent, err)
	}
	if _, _, err := s.SaveNativeSensorConfig(ctx, source, "/device/GW-1/node/2/sensor_config", map[string]any{"content": protocol("v", 2)}); err == nil {
		t.Fatal("source console accepted a request missing wait_time")
	}
	for _, index := range []int{3, 4, 5} {
		if _, err := save(index, metricsOnly); err == nil || posts.Load() != 0 {
			t.Fatalf("node %d: incompatible, absent or unavailable latest config must not write the source", index)
		}
	}
	if _, err := save(5, advanced(20, 1)); err == nil || posts.Load() != 0 {
		t.Fatal("an unavailable latest config must not be treated as a missing config")
	}
	assertSave(1, advanced(30, 1), "accepted", 1) // Native wait time changed.
	assertSave(1, advanced(30, 2), "accepted", 2) // Native protocol changed.
	assertSave(4, advanced(20, 1), "accepted", 3) // First source configuration.
}
