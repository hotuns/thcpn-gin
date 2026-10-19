package firmware

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"thcpn-gin/internal/audit"
	"thcpn-gin/internal/testdb"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type libraryFixture struct {
	db                    *pgxpool.Pool
	service               *Service
	admin, source, device uuid.UUID
	store, otherStore     *memoryStore
	publisher             *fakePublisher
}

func fixture(t *testing.T) libraryFixture {
	t.Helper()
	db := testdb.Open(t, 0)
	admin := testdb.Admin(t, db)
	source, device := uuid.New(), uuid.New()
	execTest(t, db, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:TEST',$2)`, source, admin)
	execTest(t, db, `INSERT INTO devices(id,name,serial_no,device_type) VALUES($1,'Gateway','GW-1','gateway')`, device)
	execTest(t, db, `INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW-1')`, device, source)
	execTest(t, db, `INSERT INTO device_capabilities(device_id,capability_code) VALUES($1,'firmware_update')`, device)
	store, other, publisher := &memoryStore{}, &memoryStore{}, &fakePublisher{}
	return libraryFixture{db: db, service: NewService(db, publisher, map[string]ArtifactStore{"lorawan_v2": {Store: store, PublicURLPrefix: "https://lora.example.test"}, "thcpn": {Store: other, PublicURLPrefix: "https://thcpn.example.test"}, "carbon": {Store: other, PublicURLPrefix: "https://carbon.example.test"}}), admin: admin, source: source, device: device, store: store, otherStore: other, publisher: publisher}
}
func execTest(t *testing.T, db *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := db.Exec(t.Context(), sql, args...); err != nil {
		t.Fatal(err)
	}
}
func (f libraryFixture) upload(t *testing.T) Artifact {
	t.Helper()
	a, err := f.service.UploadFirmware(t.Context(), UploadInput{Filename: "gateway.bin", Version: "5.2.1", VerifyValue: "0123456789ABCDEF0123456789abcdef", Body: bytes.NewBufferString("data"), SizeBytes: 4, DataSourceID: f.source, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	return a
}
func (f libraryFixture) publish(t *testing.T, a Artifact) Release {
	t.Helper()
	r, err := f.service.PublishFirmware(t.Context(), PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestLibraryUploadReusesArtifactAcrossReleases(t *testing.T) {
	f := fixture(t)
	a := f.upload(t)
	if len(f.publisher.sourceCalls) != 0 || f.otherStore.puts != 0 || f.store.puts != 1 || !strings.HasPrefix(a.PublicURL, "https://lora.example.test/firmwares/") {
		t.Fatal("upload dispatched to wrong store or device")
	}
	first, second := f.publish(t, a), f.publish(t, a)
	if first.ID == second.ID || first.ObjectKey != second.ObjectKey || first.FirmwareID == nil || *first.FirmwareID != a.ID || f.store.puts != 1 || len(f.publisher.sourceCalls) != 2 {
		t.Fatal("artifact was not reused")
	}
	replay, err := f.service.PublishFirmware(t.Context(), PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: readReleaseKey(t, f.db, first.ID)})
	if err != nil || replay.ID != first.ID || len(f.publisher.sourceCalls) != 2 {
		t.Fatalf("replay: %v", err)
	}
	list, err := f.service.ListFirmware(t.Context(), 1, 20, "lorawan_v2")
	if err != nil || list.Total != 1 {
		t.Fatalf("list: %#v %v", list, err)
	}
	targets, err := f.service.Candidates(t.Context(), &a.ID, 1, 100)
	if err != nil || len(targets) != 1 {
		t.Fatalf("candidates: %#v %v", targets, err)
	}
	filtered, err := f.service.ListFirmwareForDevice(t.Context(), 1, 20, "", f.device)
	if err != nil || filtered.Total != 1 {
		t.Fatalf("device firmware list: %#v %v", filtered, err)
	}
	execTest(t, f.db, `UPDATE devices SET product_id='different-model' WHERE id=$1`, f.device)
	filtered, err = f.service.ListFirmwareForDevice(t.Context(), 1, 20, "", f.device)
	if err != nil || filtered.Total != 1 {
		t.Fatalf("source firmware unexpectedly filtered: %#v %v", filtered, err)
	}
	var audits int
	if err = f.db.QueryRow(t.Context(), `SELECT count(*) FROM audit_logs WHERE actor_admin_id=$1 AND action IN ('firmware.library.upload','firmware.release.create')`, f.admin).Scan(&audits); err != nil || audits != 3 {
		t.Fatalf("audit count %d %v", audits, err)
	}
}
func readReleaseKey(t *testing.T, db *pgxpool.Pool, id uuid.UUID) uuid.UUID {
	t.Helper()
	var key uuid.UUID
	if err := db.QueryRow(t.Context(), `SELECT idempotency_key FROM firmware_releases WHERE id=$1`, id).Scan(&key); err != nil {
		t.Fatal(err)
	}
	return key
}
func TestLibraryRejectsChangedSourceTypeAndProduct(t *testing.T) {
	f := fixture(t)
	a := f.upload(t)
	ctx := t.Context()
	for _, change := range []string{"source", "family", "type", "disabled"} {
		t.Run(change, func(t *testing.T) {
			switch change {
			case "source":
				other := uuid.New()
				execTest(t, f.db, `INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Other','http_api','lorawan_v2','env:TEST',$2)`, other, f.admin)
				execTest(t, f.db, `UPDATE device_source_refs SET data_source_id=$2 WHERE device_id=$1`, f.device, other)
			case "family":
				execTest(t, f.db, `UPDATE data_sources SET source_family='thcpn' WHERE id=$1`, f.source)
				execTest(t, f.db, `UPDATE device_source_refs SET external_key='12' WHERE device_id=$1`, f.device)
			case "type":
				execTest(t, f.db, `UPDATE devices SET device_type='standalone' WHERE id=$1`, f.device)
			case "product":
				execTest(t, f.db, `UPDATE devices SET product_id='different-model' WHERE id=$1`, f.device)
			case "disabled":
				execTest(t, f.db, `UPDATE devices SET status='disabled' WHERE id=$1`, f.device)
			}
			_, err := f.service.PublishFirmware(ctx, PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
			if err == nil || len(f.publisher.sourceCalls) != 0 {
				t.Fatal("incompatible target reached publisher")
			}
			execTest(t, f.db, `UPDATE devices SET product_id=NULL,device_type='gateway',status='active' WHERE id=$1`, f.device)
			execTest(t, f.db, `UPDATE device_source_refs SET data_source_id=$2,external_key='GW-1' WHERE device_id=$1`, f.device, f.source)
			execTest(t, f.db, `UPDATE data_sources SET source_family='lorawan_v2' WHERE id=$1`, f.source)
		})
	}
}
func TestLibraryArchiveAndRetryBindingGuard(t *testing.T) {
	f := fixture(t)
	a := f.upload(t)
	f.publisher.fail = true
	r := f.publish(t, a)
	if r.Status != "failed" || f.store.deleted {
		t.Fatal("failed release must retain library artifact")
	}
	execTest(t, f.db, `UPDATE device_source_refs SET external_key='changed-sn' WHERE device_id=$1`, f.device)
	f.publisher.fail = false
	retried, err := f.service.Retry(t.Context(), r.ID, r.Targets[0].ID)
	if err == nil || retried.Status != "failed" || len(f.publisher.sourceCalls) != 1 {
		t.Fatalf("retry guard: %#v %v", retried, err)
	}
	execTest(t, f.db, `UPDATE device_source_refs SET external_key='GW-1' WHERE device_id=$1`, f.device)
	if err = f.service.SetFirmwareArchived(t.Context(), a.ID, true, f.admin); err != nil {
		t.Fatal(err)
	}
	_, err = f.service.PublishFirmware(t.Context(), PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err == nil {
		t.Fatal("archived artifact published")
	}
	retried, err = f.service.Retry(t.Context(), r.ID, r.Targets[0].ID)
	if err == nil || retried.Status != "failed" || len(f.publisher.sourceCalls) != 1 {
		t.Fatal("archived artifact retried")
	}
	if err = f.service.SetFirmwareArchived(t.Context(), a.ID, false, f.admin); err != nil {
		t.Fatal(err)
	}
	retried, err = f.service.Retry(t.Context(), r.ID, r.Targets[0].ID)
	if err != nil || retried.Status != "completed" || f.store.puts != 1 {
		t.Fatalf("restore retry: %v", err)
	}
}
func TestLibraryUploadSizeMismatchCleansObject(t *testing.T) {
	f := fixture(t)
	_, err := f.service.UploadFirmware(t.Context(), UploadInput{Filename: "f.bin", Version: "1.2.3", VerifyValue: strings.Repeat("a", 32), Body: strings.NewReader("longer"), SizeBytes: 1, DataSourceID: f.source, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err == nil || !f.store.deleted {
		t.Fatal("size mismatch accepted")
	}
	list, err := f.service.ListFirmware(t.Context(), 1, 20, "")
	if err != nil || list.Total != 0 {
		t.Fatal("invalid upload saved")
	}
}
func TestLibraryUploadDoesNotRequireAnyEligibleDevice(t *testing.T) {
	f := fixture(t)
	execTest(t, f.db, `UPDATE devices SET status='disabled' WHERE id=$1`, f.device)
	execTest(t, f.db, `DELETE FROM device_capabilities WHERE device_id=$1`, f.device)
	a := f.upload(t)
	if a.DataSourceID != f.source || f.store.puts != 1 || len(f.publisher.sourceCalls) != 0 {
		t.Fatal("source-only upload depended on a reference device")
	}
	execTest(t, f.db, `UPDATE data_sources SET status='disabled' WHERE id=$1`, f.source)
	_, err := f.service.UploadFirmware(t.Context(), UploadInput{DataSourceID: f.source, Filename: "f.bin", Version: "1.2.3", VerifyValue: strings.Repeat("a", 32), SizeBytes: 4, Body: strings.NewReader("data"), ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err == nil || f.store.puts != 1 {
		t.Fatal("inactive source uploaded firmware")
	}
}
func TestLibrarySameSourceIgnoresDeviceTypeAndProduct(t *testing.T) {
	f := fixture(t)
	execTest(t, f.db, `UPDATE data_sources SET source_family='thcpn' WHERE id=$1`, f.source)
	execTest(t, f.db, `UPDATE device_source_refs SET external_key='12' WHERE device_id=$1`, f.device)
	a := f.upload(t)
	first := f.publish(t, a)
	execTest(t, f.db, `UPDATE devices SET device_type='standalone',product_id='other-product' WHERE id=$1`, f.device)
	second := f.publish(t, a)
	if first.Status != "completed" || second.Status != "completed" || f.otherStore.puts != 1 || len(f.publisher.sourceCalls) != 2 {
		t.Fatal("same-source firmware was unnecessarily device-scoped")
	}
}
func TestLibraryMigrationRoundTrip(t *testing.T) {
	db := testdb.Open(t, 42)
	for _, name := range []string{"000043_firmware_library.up.sql", "000043_firmware_library.down.sql", "000043_firmware_library.up.sql"} {
		testdb.Apply(t, db, filepath.Join("../../migrations", name))
	}
}

func TestLibraryConcurrentPublishIdempotency(t *testing.T) {
	f := fixture(t)
	a := f.upload(t)
	input := PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: uuid.New()}
	var wg sync.WaitGroup
	failures := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := f.service.PublishFirmware(t.Context(), input); failures <- err }()
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(f.publisher.sourceCalls) != 1 || f.store.puts != 1 {
		t.Fatal("concurrent request registered twice")
	}
	input.DeviceIDs = append(input.DeviceIDs, uuid.New())
	if _, err := f.service.PublishFirmware(t.Context(), input); err == nil {
		t.Fatal("same key reused for different targets")
	}
}

func TestLibraryAuditPreservesRequestMetadata(t *testing.T) {
	f := fixture(t)
	a := f.upload(t)
	ctx := context.WithValue(t.Context(), auditRequestKey{}, audit.RecordInput{IP: "127.0.0.1", UserAgent: "firmware-test", RequestID: "request-test", Reason: "requested upgrade"})
	release, err := f.service.PublishFirmware(ctx, PublishInput{FirmwareID: a.ID, DeviceIDs: []uuid.UUID{f.device}, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
	if err != nil {
		t.Fatal(err)
	}
	var ip, agent, requestID, reason string
	if err = f.db.QueryRow(t.Context(), `SELECT ip,user_agent,request_id,reason FROM audit_logs WHERE resource_id=$1 AND action='firmware.release.create'`, release.ID).Scan(&ip, &agent, &requestID, &reason); err != nil {
		t.Fatal(err)
	}
	if ip != "127.0.0.1" || agent != "firmware-test" || requestID != "request-test" || reason != "requested upgrade" {
		t.Fatal("audit request context was lost")
	}
}

func TestLibraryUsesEachSourcesOwnStore(t *testing.T) {
	for _, family := range []string{"thcpn", "carbon"} {
		t.Run(family, func(t *testing.T) {
			f := fixture(t)
			execTest(t, f.db, `UPDATE data_sources SET source_family=$2 WHERE id=$1`, f.source, family)
			execTest(t, f.db, `UPDATE device_source_refs SET external_key='12' WHERE device_id=$1`, f.device)
			build := int64(123)
			a, err := f.service.UploadFirmware(t.Context(), UploadInput{Filename: "firmware.bin", Version: "1.2.3", BuildID: &build, VerifyValue: strings.Repeat("A", 32), SizeBytes: 4, Body: strings.NewReader("data"), DataSourceID: f.source, ActorAdminID: f.admin, IdempotencyKey: uuid.New()})
			if err != nil || f.store.puts != 0 || f.otherStore.puts != 1 || !strings.HasPrefix(a.PublicURL, "https://"+family+".example.test/") {
				t.Fatalf("wrong store %s: %v", a.PublicURL, err)
			}
			r := f.publish(t, a)
			if r.Status != "completed" || len(f.publisher.sourceCalls) != 1 || f.publisher.sourceCalls[0].PublicURL != a.PublicURL {
				t.Fatal("source did not receive library URL")
			}
		})
	}
}

func TestLibraryMigrationPreservesHistoryAndScopes(t *testing.T) {
	f := fixture(t)
	testdb.Apply(t, f.db, "../../migrations/000043_firmware_library.down.sql")
	device2 := uuid.New()
	execTest(t, f.db, `INSERT INTO devices(id,name,serial_no,device_type,product_id) VALUES($1,'Other','GW-2','standalone','legacy-model')`, device2)
	single, mixed := uuid.New(), uuid.New()
	for _, id := range []uuid.UUID{single, mixed} {
		execTest(t, f.db, `INSERT INTO firmware_releases(id,original_filename,object_key,public_url,content_type,size_bytes,version,firmware_version,verify_value,source_family,created_by,idempotency_key) VALUES($1,'old.bin',$2,'https://lora.example.test/old.bin','application/octet-stream',4,'1.2.3',16909056,$3,'lorawan_v2',$4,$5)`, id, id.String(), strings.Repeat("a", 32), f.admin, uuid.New())
		execTest(t, f.db, `INSERT INTO firmware_release_targets(release_id,device_id,data_source_id,gateway_sn) VALUES($1,$2,$3,'GW-1')`, id, f.device, f.source)
	}
	execTest(t, f.db, `INSERT INTO firmware_release_targets(release_id,device_id,data_source_id,gateway_sn) VALUES($1,$2,$3,'GW-2')`, mixed, device2, f.source)
	testdb.Apply(t, f.db, "../../migrations/000043_firmware_library.up.sql")
	singleRelease, err := f.service.Get(t.Context(), single)
	if err != nil || singleRelease.FirmwareID == nil {
		t.Fatalf("single scope migration: %v", err)
	}
	mixedRelease, err := f.service.Get(t.Context(), mixed)
	if err != nil || mixedRelease.FirmwareID != nil || len(mixedRelease.Targets) != 2 {
		t.Fatalf("ambiguous history changed: %v", err)
	}
	library, err := f.service.ListFirmware(t.Context(), 1, 20, "")
	if err != nil || library.Total != 1 {
		t.Fatal("ambiguous artifact was added to library")
	}
}
func TestLibraryWriteHandlersRequireAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewHandler(nil, nil)
	for _, route := range []struct {
		method, path, body string
		handler            gin.HandlerFunc
	}{
		{"POST", "/firmwares", "", handler.UploadFirmware}, {"POST", "/releases", `{"firmware_id":"00000000-0000-0000-0000-000000000000"}`, handler.Create}, {"PATCH", "/firmwares/:firmware_id", `{"archived":true}`, handler.ArchiveFirmware},
	} {
		router := gin.New()
		router.Handle(route.method, route.path, route.handler)
		req := httptest.NewRequestWithContext(context.Background(), route.method, strings.ReplaceAll(route.path, ":firmware_id", uuid.NewString()), strings.NewReader(route.body))
		req.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != http.StatusUnauthorized {
			t.Fatalf("%s: %d", route.path, response.Code)
		}
	}
}
