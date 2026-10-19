package thcpn

import (
	"encoding/json"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"thcpn-gin/internal/db/sqlc"
	"thcpn-gin/internal/testdb"
)

func TestTHCPNLegacyConfigProjection(t *testing.T) {
	raw := json.RawMessage(`{"temp":{"desc":"温度","type":"temperature","unit":"℃"},"img_env":{"desc":"环境图像","type":"image"}}`)
	specs, err := buildTHCPNStreamSpecs(105, raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(specs) != 2 || specs[0].Code != "img_env" || specs[0].Type != "image" || specs[0].PayloadType != "media" || specs[1].Code != "temp" || specs[1].Name != "温度" || specs[1].Unit != "℃" {
		t.Fatalf("unexpected projection: %+v", specs)
	}
	if string(raw) != `{"temp":{"desc":"温度","type":"temperature","unit":"℃"},"img_env":{"desc":"环境图像","type":"image"}}` {
		t.Fatal("source config changed")
	}
	for _, invalid := range []string{`[{"params":[]}]`, `["invalid"]`, `{"temp":"invalid"}`} {
		if _, err := buildTHCPNStreamSpecs(1, json.RawMessage(invalid), nil); err == nil {
			t.Fatalf("accepted malformed config %s", invalid)
		}
	}
}

func TestTHCPNAvatarFailureDoesNotBlockDeviceAndRetries(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	deviceID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO devices(id,name,device_type) VALUES($1,'avatar retry','standalone')`, deviceID); err != nil {
		t.Fatal(err)
	}
	var valid atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/bad" && !valid.Load() {
			http.Error(w, "missing", 404)
			return
		}
		w.Write([]byte("\x89PNG\r\n\x1a\nimage"))
	}))
	defer server.Close()
	svc := newTestService(db)
	// Exercise the core device/config transaction with the failing avatar attached.
	admin, sourceID := testdb.Admin(t, db), uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'THCPN','mysql','thcpn','env:NOT_USED',$2)`, sourceID, admin); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'thcpn_legacy_mysql','42')`, deviceID, sourceID); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	native := json.RawMessage(`{"temp":{"desc":"温度","type":"temperature","unit":"℃"}}`)
	core, err := svc.syncTHCPNDevice(ctx, sqlc.New(tx), sqlc.DataSource{ID: sourceID}, thcpnDeviceSyncInput{ExternalDeviceID: 42, DeviceType: "standalone", ActorUserID: admin, ExternalDevice: &thcpnExternalDevice{THCPNExternalDeviceMetadata: THCPNExternalDeviceMetadata{Name: "avatar retry", AvatarURLs: []string{server.URL + "/bad"}}}, ExternalConfig: &thcpnExternalConfig{ID: 1, DeviceID: 42, Data: native, Image: json.RawMessage(`[]`), Control: json.RawMessage(`{}`)}})
	if err != nil {
		t.Fatalf("avatar blocked core sync: %v", err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if core.Device.ID != deviceID || len(core.DataStreams) != 1 {
		t.Fatalf("core projection lost: %+v", core)
	}
	warnings := svc.syncTHCPNAvatarsAfterCommit(ctx, deviceID, []string{server.URL + "/bad", server.URL + "/good"})
	if len(warnings) != 1 {
		t.Fatalf("expected warning: %+v", warnings)
	}
	q := sqlc.New(db)
	images, err := q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil || len(images) != 1 {
		t.Fatalf("valid avatar lost: %v %v", images, err)
	}
	valid.Store(true)
	if warnings = svc.syncTHCPNAvatarsAfterCommit(ctx, deviceID, []string{server.URL + "/bad", server.URL + "/good"}); len(warnings) != 0 {
		t.Fatal(warnings)
	}
	images, err = q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil || len(images) != 2 {
		t.Fatalf("retry failed or duplicated: %v %v", images, err)
	}
}
