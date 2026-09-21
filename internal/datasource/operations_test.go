package datasource

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/testdb"
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
	result, err := NewService(db).CreateLoRaWANV2Gateway(ctx, source, sn, 1, admin)
	if err != nil {
		t.Fatal(err)
	}
	if result.Sync == nil || result.Sync.Device.SerialNo != sn {
		t.Fatalf("gateway projection did not adopt upstream SN: %#v", result)
	}
	if result.CatalogWarning == "" {
		t.Fatal("expected catalog warning")
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
	if err := svc.finishSourceOperation(op.ID, "completed", map[string]int{"synced": 1}, nil); err != nil {
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
