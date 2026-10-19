package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	lorawanv2 "thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestCreateLoRaWANV2GatewayUsesUpstreamSNAndSurvivesCatalogFailure(t *testing.T) {
	const sn = "898604B41025D0999999"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/device/"+sn:
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"success":false,"error_code":"0x10010201","error_message":"not found"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/device":
			_, _ = w.Write([]byte(`{"success":true,"payload":{"sn":"` + sn + `","node_count":1}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/device/"+sn+"/config":
			var request map[string]any
			if json.NewDecoder(r.Body).Decode(&request) != nil || request["system"].(map[string]any)["did"] != sn || request["system"].(map[string]any)["cid"] != nil {
				t.Error("default configuration missing generated device SN")
			}
			_, _ = w.Write([]byte(`{"success":true,"payload":{"id":1}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/device/"+sn+"/infos":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"success":false,"error_code":"test","error_message":"not ready"}`))
		default:
			http.Error(w, r.URL.Path, http.StatusNotFound)
		}
	}))
	defer server.Close()

	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	const envKey = "TEST_LORAWAN_V2_CREATE_SECRET"
	t.Setenv(envKey, fmt.Sprintf(`{"base_url":%q,"username":"reader","password":"secret"}`, server.URL))
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2',$2,$3)`, source, "env:"+envKey, admin); err != nil {
		t.Fatal(err)
	}
	result, err := NewService(db).LoRaWAN.CreateLoRaWANV2Gateway(ctx, source, sn, 1, admin)
	if err != nil {
		t.Fatal(err)
	}
	if result.Sync == nil || result.Sync.Device.SerialNo != sn {
		t.Fatalf("gateway projection did not adopt upstream SN: %#v", result)
	}
	if result.CatalogWarning == "" {
		t.Fatal("expected catalog warning")
	}
	if result.ConfigError != "" {
		t.Fatalf("default config failed: %s", result.ConfigError)
	}
	var serial string
	if err := db.QueryRow(ctx, `SELECT serial_no FROM devices WHERE id=$1`, result.Sync.Device.ID).Scan(&serial); err != nil {
		t.Fatal(err)
	}
	if serial != sn {
		t.Fatalf("serial_no=%q, want %q", serial, sn)
	}
	var firmwareCapability bool
	if err := db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM device_capabilities WHERE device_id=$1 AND capability_code='firmware_update')`, result.Sync.Device.ID).Scan(&firmwareCapability); err != nil {
		t.Fatal(err)
	}
	if !firmwareCapability {
		t.Fatal("LoRaWAN V2 gateway is missing firmware_update capability")
	}
}
func TestGatewayDefaultConfigurationRetryDoesNotCreateDuplicateDevice(t *testing.T) {
	db := testdb.Open(t, 0)
	actor := testdb.Admin(t, db)
	source := uuid.New()
	sn := lorawanv2.GeneratedLoRaWANV2SN(source, actor, uuid.New())
	deviceCreates, configAttempts := 0, 0
	exists, configured := false, false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && r.URL.Path == "/device/"+sn:
			if !exists {
				w.WriteHeader(404)
				fmt.Fprint(w, `{"success":false,"error_code":"0x10010201"}`)
				return
			}
			fmt.Fprintf(w, `{"success":true,"payload":{"sn":%q,"node_count":1}}`, sn)
		case r.Method == "POST" && r.URL.Path == "/device":
			exists = true
			deviceCreates++
			fmt.Fprintf(w, `{"success":true,"payload":{"sn":%q,"node_count":1}}`, sn)
		case r.Method == "GET" && r.URL.Path == "/device/"+sn+"/configs":
			if configured {
				fmt.Fprint(w, `{"success":true,"payload":[{"id":1}]}`)
			} else {
				fmt.Fprint(w, `{"success":true,"payload":[]}`)
			}
		case r.Method == "POST" && r.URL.Path == "/device/"+sn+"/config":
			configAttempts++
			if configAttempts == 1 {
				w.WriteHeader(500)
				fmt.Fprint(w, `{"success":false,"error_message":"temporary failure"}`)
				return
			}
			configured = true
			fmt.Fprint(w, `{"success":true,"payload":{"id":1}}`)
		default:
			w.WriteHeader(500)
			fmt.Fprint(w, `{"success":false,"error_message":"no telemetry"}`)
		}
	}))
	defer server.Close()
	t.Setenv("TEST_GATEWAY_RETRY_SECRET", fmt.Sprintf(`{"base_url":%q,"username":"test","password":"test"}`, server.URL))
	if _, err := db.Exec(t.Context(), `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:TEST_GATEWAY_RETRY_SECRET',$2)`, source, actor); err != nil {
		t.Fatal(err)
	}
	service := NewService(db)
	for attempt := 0; attempt < 3; attempt++ {
		result, err := service.LoRaWAN.CreateLoRaWANV2Gateway(t.Context(), source, sn, 1, actor)
		if err != nil || result.Sync == nil {
			t.Fatalf("gateway create failed: %v", err)
		}
		if (attempt == 0) != (result.ConfigError != "") {
			t.Fatal("default configuration result did not reflect failure or recovery")
		}
	}
	if deviceCreates != 1 || configAttempts != 2 {
		t.Fatalf("duplicate device/configuration writes: devices=%d configs=%d", deviceCreates, configAttempts)
	}
}

type recordingSyncQueue struct {
	ids []uuid.UUID
	err error
}

func (q *recordingSyncQueue) EnqueueSourceSync(_ context.Context, id uuid.UUID) error {
	q.ids = append(q.ids, id)
	return q.err
}
func TestSourceSyncQueueKeepsOneActiveOperationAndRecordsEnqueueFailure(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'THCPN','mysql','thcpn','env:UNUSED',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db)
	queue := &recordingSyncQueue{}
	svc.SetSyncQueue(queue)
	op, err := svc.StartSourceSync(ctx, source, admin)
	if err != nil {
		t.Fatal(err)
	}
	if op.Status != "queued" || len(queue.ids) != 1 || queue.ids[0] != op.ID {
		t.Fatalf("not queued: %#v", op)
	}
	if _, err := svc.StartSourceSync(ctx, source, admin); err == nil {
		t.Fatal("duplicate source sync accepted")
	}
	if err := svc.FinishSourceOperation(op.ID, "completed", map[string]int{"synced": 1}, nil); err != nil {
		t.Fatal(err)
	}
	if err := svc.RunSourceSync(ctx, op.ID); err != nil {
		t.Fatal("completed job should be idempotent", err)
	}
	queue.err = errors.New("queue unavailable")
	if _, err := svc.StartSourceSync(ctx, source, admin); err == nil {
		t.Fatal("enqueue failure hidden")
	}
	items, err := svc.ListSourceOperations(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Status != "failed" {
		t.Fatalf("missing persisted failure: %#v", items)
	}
}
func TestSourceSyncQueueAcceptsLoRaWANV2(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa V2','http_api','lorawan_v2','env:UNUSED',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	svc := NewService(db)
	queue := &recordingSyncQueue{}
	svc.SetSyncQueue(queue)
	op, err := svc.StartSourceSync(ctx, source, admin)
	if err != nil {
		t.Fatal(err)
	}
	if op.Status != "queued" || len(queue.ids) != 1 || queue.ids[0] != op.ID {
		t.Fatalf("LoRaWAN V2 sync not queued: %#v", op)
	}
}
