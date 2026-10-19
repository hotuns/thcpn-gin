package lorawanv2

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestDeviceConfigPathsAndPartialSnapshotFailure(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, id := uuid.New(), uuid.New()
	var requests atomic.Int32
	var lastPath atomic.Value
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		lastPath.Store(r.URL.Path)
		if r.URL.Query().Get("node_index") != "" || r.URL.Query().Get("latest") != "" {
			t.Error("platform target options leaked into upstream query")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"payload":{"id":42}}`))
	}))
	defer server.Close()
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, []any{source, admin}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, []any{id}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW-1')`, []any{id, source}},
		{`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','1',$2,$2)`, []any{id, admin}},
	} {
		if _, err := db.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "reader", "password": "test-secret"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
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
	request.NodeIndex = 2
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
	if requests.Load() != before+1 {
		t.Fatal("accepted source write repeated or unnecessary source sync attempted")
	}
	op, err := s.GetSourceOperation(ctx, result.WriteState.OperationID)
	if err != nil || op.Status != "partial" {
		t.Fatalf("partial operation: %+v %v", op, err)
	}
}
