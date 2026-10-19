package lorawanv2

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/testdb"

	"github.com/google/uuid"
)

func TestFirmwareUsesSourceAPIContract(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source := uuid.New()
	var missingID atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, password, ok := r.BasicAuth()
		if !ok || user != "reader" || password != "test-secret" || r.Method != http.MethodPost || r.URL.Path != "/device/GW-1/firmware" {
			t.Errorf("wrong source API target or auth: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Version uint32 `json:"firmware_version"`
			URL     string `json:"url"`
			Verify  string `json:"verify_value"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Version != 16909056 || body.URL != "https://example.test/fw.bin" || body.Verify != "md5-value" {
			t.Errorf("wrong source payload: %+v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		if missingID.Load() {
			_, _ = w.Write([]byte(`{"success":true,"payload":{}}`))
		} else {
			_, _ = w.Write([]byte(`{"success":true,"payload":{"id":42}}`))
		}
	}))
	defer server.Close()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','secret:test',$2)`, source, admin); err != nil {
		t.Fatal(err)
	}
	s := newTestService(db)
	secret, _ := json.Marshal(map[string]string{"base_url": server.URL, "username": "reader", "password": "test-secret"})
	s.Runtime = platform.NewRuntime(staticResolver(secret))
	input := platform.SourceFirmwareInput{DataSourceID: source, GatewaySN: "GW-1", EncodedVersion: 16909056, PublicURL: "https://example.test/fw.bin", VerifyValue: "md5-value"}
	id, err := s.RegisterFirmware(ctx, input)
	if err != nil || id != 42 {
		t.Fatalf("register firmware: id=%d error=%v", id, err)
	}
	missingID.Store(true)
	if _, err := s.RegisterFirmware(ctx, input); err == nil {
		t.Fatal("missing upstream id accepted")
	}
}
