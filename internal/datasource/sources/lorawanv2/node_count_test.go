package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestNodeCountProjectionAndSafeRetries(t *testing.T) {
	db := testdb.Open(t, 0)
	actor := testdb.Admin(t, db)
	id, source := uuid.New(), uuid.New()
	var count, writes, failure atomic.Int32
	count.Store(2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path != "/device/GW" {
			t.Errorf("unexpected old-node scan or configuration write: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		if r.Method == "POST" {
			writes.Add(1)
			var body struct {
				Count int32 `json:"node_count"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if failure.Load() != 2 {
				count.Store(body.Count)
			}
			if failure.Load() != 0 {
				w.WriteHeader(500)
				fmt.Fprint(w, `{"success":false,"error_message":"response lost"}`)
				return
			}
		}
		fmt.Fprintf(w, `{"success":true,"payload":{"sn":"GW","node_count":%d}}`, count.Load())
	}))
	defer server.Close()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(t.Context(), query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, source, actor)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Custom gateway name','gateway')`, id)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, id, source)
	must(`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','2',$2,$2)`, id, actor)
	must(`INSERT INTO data_streams(device_id,code,name,type,created_by) VALUES($1,'custom_old_metric','Existing metric','telemetry',$2)`, id, actor)
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	result, err := s.UpdateNodeCount(t.Context(), id, actor, 4)
	if err != nil || result.Status != "completed" || result.WriteState.Source != "accepted" || result.WriteState.Platform != "synced" || result.WriteState.Device != "unknown" {
		t.Fatalf("increase: %+v %v", result, err)
	}
	if writes.Load() != 1 {
		t.Fatal("wrong source write count")
	}
	var name string
	var projected, streams int
	check := func(want int) {
		t.Helper()
		if err := db.QueryRow(t.Context(), `SELECT name FROM devices WHERE id=$1`, id).Scan(&name); err != nil || name != "Custom gateway name" {
			t.Fatalf("name changed: %s %v", name, err)
		}
		if err := db.QueryRow(t.Context(), `SELECT value_json::text::int FROM device_metadata WHERE device_id=$1 AND key='lorawan_v2_nodes_count'`, id).Scan(&projected); err != nil || projected != want {
			t.Fatalf("node count: %d %v", projected, err)
		}
	}
	check(4)
	if err := db.QueryRow(t.Context(), `SELECT count(*) FROM data_streams WHERE device_id=$1 AND status='active'`, id).Scan(&streams); err != nil || streams != 9 {
		t.Fatalf("new diagnostics or old metric lost: %d %v", streams, err)
	}
	if _, err = s.UpdateNodeCount(t.Context(), id, actor, 1); apperr.KindOf(err) != apperr.KindConflict || writes.Load() != 1 {
		t.Fatal("decrease reached source")
	}
	if _, err = s.UpdateNodeCount(t.Context(), id, actor, 4); err != nil || writes.Load() != 1 {
		t.Fatal("equal count repeated source write")
	}

	// A local projection failure cannot roll back the upstream update. Retrying
	// the same absolute total repairs it without writing to the gateway again.
	must(`ALTER TABLE device_metadata ADD CONSTRAINT reject_count CHECK(key!='lorawan_v2_nodes_count' OR value_json::text::int<=4) NOT VALID`)
	partial, err := s.UpdateNodeCount(t.Context(), id, actor, 5)
	if err != nil || partial.Status != "partial" || partial.WriteState.Source != "accepted" || partial.WriteState.Platform != "failed" {
		t.Fatalf("partial outcome: %+v %v", partial, err)
	}
	check(4)
	operation, err := s.GetSourceOperation(t.Context(), partial.WriteState.OperationID)
	if err != nil || operation.Status != "partial" {
		t.Fatalf("missing operation record: %+v %v", operation, err)
	}
	must(`ALTER TABLE device_metadata DROP CONSTRAINT reject_count`)
	if result, err = s.UpdateNodeCount(t.Context(), id, actor, 5); err != nil || result.Status != "completed" || writes.Load() != 2 {
		t.Fatalf("projection recovery repeated write: %+v %v", result, err)
	}
	check(5)
	failure.Store(1)
	if result, err = s.UpdateNodeCount(t.Context(), id, actor, 6); err != nil || result.Status != "completed" {
		t.Fatalf("committed update was not verified by readback: %+v %v", result, err)
	}
	failure.Store(2)
	if _, err = s.UpdateNodeCount(t.Context(), id, actor, 7); err == nil {
		t.Fatal("unconfirmed update reported success")
	}
	check(6)
	var unknown int
	if err := db.QueryRow(t.Context(), `SELECT count(*) FROM source_operations WHERE device_id=$1 AND status='unknown'`, id).Scan(&unknown); err != nil || unknown != 1 {
		t.Fatal("missing unknown outcome")
	}
	unlock, err := s.LockSourceSync(t.Context(), source.String()+"/lorawan_v2/GW")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	before := writes.Load()
	if _, err = s.UpdateNodeCount(t.Context(), id, actor, 8); apperr.KindOf(err) != apperr.KindConflict || writes.Load() != before {
		t.Fatal("concurrent sync was not protected")
	}
}

func TestNodeCountRejectsInvalidInputsBeforeAccess(t *testing.T) {
	s := newTestService(nil)
	for _, count := range []int{-1, 0, 255} {
		if _, err := s.UpdateNodeCount(t.Context(), uuid.New(), uuid.New(), count); apperr.KindOf(err) != apperr.KindInvalidArgument {
			t.Fatalf("invalid count %d: %v", count, err)
		}
	}
}
