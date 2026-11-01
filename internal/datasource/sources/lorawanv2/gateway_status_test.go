package lorawanv2

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"testing"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"
	"time"
)

func TestGatewayConnectionAndActivityUseDedicatedEndpoints(t *testing.T) {
	db := testdb.Open(t, 0)
	actor := testdb.Admin(t, db)
	source, gateway := uuid.New(), uuid.New()
	ctx := t.Context()
	mode := "online"
	calls := map[string]int{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.RawQuery != "" {
			t.Error("connection/activity must not use history windows or pagination")
		}
		calls[r.URL.Path]++
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/device/GW/connection":
			if mode == "error" {
				w.WriteHeader(500)
				fmt.Fprint(w, `{"success":false,"error_message":"Broker request failed"}`)
				return
			}
			if mode == "invalid" {
				fmt.Fprint(w, `{"success":true,"payload":{"state":"invalid","checked_at":"bad"}}`)
				return
			}
			fmt.Fprintf(w, `{"success":true,"payload":{"gateway_sn":"GW","state":%q,"checked_at":"2026-11-01T08:00:00Z","provider":"aliyun","client_id":"GW","last_received_at":null,"last_collected_at":null}}`, mode)
		case "/device/GW/activity":
			fmt.Fprint(w, `{"success":true,"payload":{"gateway_sn":"GW","last_received_at":"2026-11-01T07:00:00Z","last_collected_at":null}}`)
		default:
			t.Errorf("unexpected fallback endpoint: %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	for _, item := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, []any{source, actor}},
		{`INSERT INTO devices(id,name,device_type) VALUES($1,'Gateway','gateway')`, []any{gateway}},
		{`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW')`, []any{gateway, source}},
	} {
		if _, err := db.Exec(ctx, item.sql, item.args...); err != nil {
			t.Fatal(err)
		}
	}
	svc := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "test", "password": "test"})
	svc.Runtime = platform.NewRuntime(staticResolver(secret))
	for _, state := range []string{"online", "offline", "unknown"} {
		mode = state
		record, err := svc.ReadGatewayConnection(ctx, gateway)
		if err != nil || record.State != state || record.CheckedAt.IsZero() || record.LastReceivedAt != nil || record.LastCollectedAt != nil {
			t.Fatalf("connection state %s was misinterpreted: %v", state, err)
		}
	}
	mode = "error"
	if _, err := svc.ReadGatewayConnection(ctx, gateway); err == nil {
		t.Fatal("Broker error was treated as a known connection state")
	}
	activity, err := svc.ReadGatewayActivity(ctx, gateway)
	want := time.Date(2026, 11, 1, 7, 0, 0, 0, time.UTC)
	if err != nil || activity.LastReceivedAt == nil || !activity.LastReceivedAt.Equal(want) || activity.LastCollectedAt != nil {
		t.Fatalf("activity lost null timestamps or depended on Broker: %v", err)
	}
	mode = "invalid"
	if _, err := svc.ReadGatewayConnection(ctx, gateway); err == nil {
		t.Fatal("invalid state accepted")
	}
	if calls["/device/GW/connection"] != 5 || calls["/device/GW/activity"] != 1 {
		t.Fatal("unexpected status endpoint calls")
	}
}
