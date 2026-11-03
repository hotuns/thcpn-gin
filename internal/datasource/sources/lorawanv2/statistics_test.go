package lorawanv2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
)

func TestObservationStatisticsAggregatesPositionsAndFormalCutoffs(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	gateway, source, foreign := uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []uuid.UUID{source, foreign} {
		must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,$3,'http_api','lorawan_v2','secret:test',$2)`, id, admin, "Statistics "+id.String())
	}
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, gateway)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, gateway, source)
	binding := func(index string, sourceID uuid.UUID, sn, status string) {
		stream := uuid.New()
		must(`INSERT INTO data_streams(id,device_id,code,name,type,status,created_by,created_by_type) VALUES($1,$2,$3,'metric','telemetry',$4,$5,'system_admin')`, stream, gateway, stream.String(), status, admin)
		config := fmt.Sprintf(`{"gateway_sn":%q,"node_index":%s,"metric":"temperature"}`, sn, index)
		must(`INSERT INTO data_stream_bindings(data_stream_id,data_source_id,adapter_code,adapter_config_json,payload_type,created_by,created_by_type,status) VALUES($1,$2,'lorawan_v2',$3,'json',$4,'system_admin',$5)`, stream, sourceID, config, admin, status)
	}
	binding("1", source, "GW", "active")
	binding("1", source, "GW", "active")
	binding("3", source, "GW", "disabled")
	binding("8", foreign, "GW", "active")
	binding("9", source, "OTHER", "active")
	binding("1000000000000000", source, "GW", "disabled")
	must(`INSERT INTO lorawan_v2_node_config_snapshots(device_id,node_index,content_hash,wait_time,content_json,metrics_json,management_status) VALUES($1,254,'historical',0,'{}','[]','unmanaged')`, gateway)
	must(`INSERT INTO node_profiles(device_id,node_index,name,updated_by,updated_by_type) VALUES($1,99,'Profile only',$2,'system_admin')`, gateway, admin)
	defaultStart := time.Date(2026, 10, 2, 0, 0, 0, 0, time.UTC)
	override := defaultStart.AddDate(0, 0, -1)
	start := time.Date(2026, 11, 2, 0, 0, 0, 0, platform.LegacySourceLocation)
	end := start.AddDate(0, 0, 2)
	for node, at := range map[int]time.Time{0: defaultStart, 3: override, 254: end.Add(time.Hour)} {
		must(`INSERT INTO device_observation_starts(device_id,node_index,starts_at,updated_by) VALUES($1,$2,$3,$4)`, gateway, node, at, admin)
	}
	mode := "success"
	calls := map[int]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/device/GW/nodes" {
			if mode == "inventory failure" {
				w.WriteHeader(503)
				return
			}
			fmt.Fprint(w, `{"success":true,"payload":{"gateway_sn":"GW","bound_node_count":2,"data":[{"id":10,"sn":"REPLACEMENT","gateway_sn":"GW","node_index":1},{"id":11,"sn":"NEW","gateway_sn":"GW","node_index":7}]}}`)
			return
		}
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) != 6 || parts[1] != "device" || parts[2] != "GW" || parts[3] != "node" || parts[5] != "statistics" {
			t.Errorf("unexpected query/history pagination: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		node, _ := strconv.Atoi(parts[4])
		calls[node]++
		if node != 1 && node != 3 && node != 7 && node != 254 {
			t.Errorf("foreign source, profile-only or capacity-derived slot queried: %d", node)
		}
		if mode == "node failure" && node == 3 {
			w.WriteHeader(503)
			return
		}
		expected := defaultStart
		if node == 3 {
			expected = override
		} else if node == 254 {
			expected = end.Add(time.Hour)
		}
		if r.URL.Query().Get("observation_start_at") != fmt.Sprint(expected.Unix()) {
			t.Errorf("node %d lost formal cutoff override/inheritance", node)
		}
		p := statisticsPayload()
		p["node_index"] = node
		records := p["records"].(map[string]any)
		records["first_at"] = expected.Format(time.RFC3339)
		if node == 3 {
			records["total"], records["last_at"] = 2, "2026-11-02T12:00:00Z"
			records["daily"] = []any{map[string]any{"date": "2026-11-02", "count": 1}, map[string]any{"date": "2026-11-03", "count": 0}}
		} else if node != 1 {
			records["total"], records["first_at"], records["last_at"] = 0, nil, nil
			records["daily"] = []any{map[string]any{"date": "2026-11-02", "count": 0}, map[string]any{"date": "2026-11-03", "count": 0}}
		}
		json.NewEncoder(w).Encode(map[string]any{"success": true, "payload": p})
	}))
	defer server.Close()
	service := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	service.Runtime = platform.NewRuntime(staticResolver(secret))
	out, err := service.ObservationStatistics(ctx, gateway, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if out.TotalRecords == nil || *out.TotalRecords != 10 || len(calls) != 4 || calls[1] != 1 || calls[3] != 1 || calls[254] != 1 || *out.Days[0].Records != 4 || *out.Days[1].Records != 2 || !out.FirstObservedAt.Equal(override) || out.LastObservedAt.Format(time.RFC3339) != "2026-11-03T12:00:00Z" {
		t.Fatalf("wrong gateway position aggregation: %+v calls=%v", out, calls)
	}
	if !out.RecordsPartial || out.Excluded || out.TotalImages != nil || out.ExpectedIntervalSeconds != nil || out.Identity != platform.ObservationIdentity(source, platform.SourceFamilyLoRaWANV2, "GW") {
		t.Fatal("position coverage, identity, images or health falsely confirmed")
	}
	for _, failure := range []string{"node failure", "inventory failure"} {
		mode = failure
		out, err = service.ObservationStatistics(ctx, gateway, start, end)
		if err == nil || out.TotalRecords != nil || out.Excluded {
			t.Fatalf("%s became a complete zero/partial gateway: %+v %v", failure, out, err)
		}
	}
}

func TestObservationStatisticsWithoutKnownPositionsStaysUnknown(t *testing.T) {
	db := testdb.Open(t, 0)
	admin := testdb.Admin(t, db)
	gateway, source := uuid.New(), uuid.New()
	for _, stmt := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Empty','gateway')`, []any{gateway}},
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Empty','http_api','lorawan_v2','secret:test',$2)`, []any{source, admin}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, []any{gateway, source}},
	} {
		if _, err := db.Exec(t.Context(), stmt.query, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/device/GW/nodes" {
			t.Error("empty inventory must not probe all protocol positions")
		}
		fmt.Fprint(w, `{"success":true,"payload":{"gateway_sn":"GW","bound_node_count":0,"data":[]}}`)
	}))
	defer server.Close()
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	out, err := s.ObservationStatistics(t.Context(), gateway, time.Now().Add(-24*time.Hour), time.Now())
	if err != nil || out.TotalRecords != nil || out.Excluded {
		t.Fatalf("empty current bindings do not rule out source-only history: %+v %v", out, err)
	}
}
