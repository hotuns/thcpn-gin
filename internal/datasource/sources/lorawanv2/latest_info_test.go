package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestLatestEndpointsKeepOldRecordsAndNullWithoutHistoryFallback(t *testing.T) {
	db := testdb.Open(t, 0)
	actor := testdb.Admin(t, db)
	id, source := uuid.New(), uuid.New()
	var mode, calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		if r.Method != http.MethodGet || r.URL.RawQuery != "" {
			t.Error("latest requests must not carry a history window or pagination")
		}
		if r.URL.Path != "/device/GW/node/2/latest" && r.URL.Path != "/device/GW/info" {
			t.Errorf("unexpected history fallback: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		if mode.Load() == 3 {
			w.WriteHeader(500)
			fmt.Fprint(w, `{"success":false,"error_message":"unavailable"}`)
			return
		}
		payload := "null"
		if mode.Load() == 0 {
			if r.URL.Path == "/device/GW/node/2/latest" {
				payload = `{"ts":1700000000,"created_at":1700000001,"battery":3.6,"rssi":-71,"snr":0}`
			} else {
				payload = `{"ts":{"$date":{"$numberLong":"1700000000000"}},"iccid":"00123456789012345678","battery":12.5,"firmware_version":"1.2.3"}`
			}
		} else if mode.Load() == 2 {
			if r.URL.Path == "/device/GW/node/2/latest" {
				payload = `{"ts":"invalid","battery":3.6}`
			} else {
				payload = `[]`
			}
		}
		fmt.Fprintf(w, `{"success":true,"payload":%s}`, payload)
	}))
	defer server.Close()
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, []any{source, actor}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, []any{id}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, []any{id, source}},
		{`INSERT INTO device_metadata(device_id,key,name,value_type,value_json,created_by,updated_by) VALUES($1,'lorawan_v2_nodes_count','Nodes','number','2',$2,$2)`, []any{id, actor}},
	} {
		if _, err := db.Exec(t.Context(), statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	node, err := s.ReadNodeRuntime(t.Context(), id, 2, "node-2", time.Now())
	if err != nil || node.SampledAt == nil || node.SampledAt.Unix() != 1700000000 || node.Battery == nil || *node.Battery != 3.6 || node.RSSI == nil || *node.RSSI != -71 || node.SNR == nil || *node.SNR != 0 {
		t.Fatalf("old latest record lost: %+v %v", node, err)
	}
	info, err := s.ReadLatestGatewayInfo(t.Context(), id)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]json.RawMessage
	if err = json.Unmarshal(info, &record); err != nil || string(record["iccid"]) != `"00123456789012345678"` || string(record["ts"]) != `{"$date":{"$numberLong":"1700000000000"}}` {
		t.Fatalf("gateway record changed: %s %v", info, err)
	}
	before := calls.Load()
	if _, err = s.ReadNodeRuntime(t.Context(), id, 3, "invalid", time.Now()); apperr.KindOf(err) != apperr.KindInvalidArgument || calls.Load() != before {
		t.Fatal("invalid target reached upstream")
	}
	mode.Store(1)
	node, err = s.ReadNodeRuntime(t.Context(), id, 2, "node-2", time.Now())
	if err != nil || node.Key != "node-2" || node.Battery != nil || node.RSSI != nil || node.SampledAt != nil {
		t.Fatalf("null fabricated runtime values: %+v %v", node, err)
	}
	info, err = s.ReadLatestGatewayInfo(t.Context(), id)
	if err != nil || string(info) != "null" {
		t.Fatalf("null info: %s %v", info, err)
	}
	for _, failure := range []int32{2, 3} {
		mode.Store(failure)
		if _, err = s.ReadNodeRuntime(t.Context(), id, 2, "node-2", time.Now()); err == nil {
			t.Fatal("invalid latest record was hidden")
		}
		if _, err = s.ReadLatestGatewayInfo(t.Context(), id); err == nil {
			t.Fatal("invalid latest info was hidden")
		}
	}
}

func TestLatestTimestampFormatsAreTheSameUTCInstant(t *testing.T) {
	for _, raw := range []string{`1700000000`, `1700000000000`, `"1700000000"`, `"1700000000000"`, `"2023-11-15T06:13:20+08:00"`, `{"$date":{"$numberLong":"1700000000000"}}`, `{"$date":"2023-11-14T22:13:20Z"}`} {
		t.Run(raw, func(t *testing.T) {
			parsed, err := loraWANV2Timestamp(json.RawMessage(raw))
			if err != nil || parsed.Unix() != 1700000000 || parsed.Location() != time.UTC {
				t.Fatalf("incorrect timestamp: %s %v", parsed, err)
			}
		})
	}
}
