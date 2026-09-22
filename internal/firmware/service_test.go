package firmware

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/url"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

type memoryStore struct {
	data    []byte
	key     string
	deleted bool
}

func (s *memoryStore) Put(_ context.Context, input objectstore.PutInput) error {
	data, err := io.ReadAll(input.Body)
	s.data = data
	s.key = input.ObjectKey
	return err
}
func (s *memoryStore) Get(context.Context, string) (objectstore.GetResult, error) {
	return objectstore.GetResult{Body: io.NopCloser(bytes.NewReader(s.data))}, nil
}
func (s *memoryStore) Delete(context.Context, string) error { s.deleted = true; return nil }

type publisherCall struct {
	source uuid.UUID
	path   string
	body   map[string]any
}
type fakePublisher struct {
	calls       []publisherCall
	sourceCalls []datasource.SourceFirmwareInput
	fail        bool
}

func (p *fakePublisher) RegisterSourceFirmware(_ context.Context, input datasource.SourceFirmwareInput) (int64, error) {
	p.sourceCalls = append(p.sourceCalls, input)
	if p.fail {
		return 0, io.ErrUnexpectedEOF
	}
	return 43, nil
}

func (p *fakePublisher) LoRaWANV2Request(_ context.Context, source uuid.UUID, _ string, path string, _ url.Values, body any) (json.RawMessage, error) {
	p.calls = append(p.calls, publisherCall{source: source, path: path, body: body.(map[string]any)})
	if p.fail {
		return nil, io.ErrUnexpectedEOF
	}
	return json.RawMessage(`{"id":42,"device_sn":"GW-1"}`), nil
}

func TestCreateCarbonFirmwareRequiresAndPublishesAdminBuildID(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, device := uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'Carbon','mysql','carbon','env:TEST',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,serial_no,device_type,status) VALUES($1,'Carbon device','C-9','carbon_sink','active')`, device)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'carbon_sink_mysql','9')`, device, source)
	must(`INSERT INTO device_capabilities(device_id,capability_code) VALUES($1,'firmware_update')`, device)
	store := &memoryStore{}
	publisher := &fakePublisher{}
	service := NewService(db, publisher, map[string]ArtifactStore{"carbon": {Store: store, PublicURLPrefix: "https://carbon.example.test"}})
	base := UploadInput{Filename: "carbon.rbl", Version: "2026.09.21", VerifyValue: "0123456789abcdef0123456789ABCDEF", SizeBytes: 4, Body: bytes.NewReader([]byte("test")), DeviceIDs: []uuid.UUID{device}, ActorAdminID: admin, IdempotencyKey: uuid.New()}
	if _, err := service.Create(ctx, base); err == nil {
		t.Fatal("expected missing Carbon build_id to fail")
	}
	buildID := int64(260921120000001)
	base.BuildID = &buildID
	base.IdempotencyKey = uuid.New()
	base.Body = bytes.NewReader([]byte("test"))
	result, err := service.Create(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if result.SourceFamily != "carbon" || result.BuildID == nil || *result.BuildID != buildID || result.Status != "completed" {
		t.Fatalf("unexpected Carbon release: %#v", result)
	}
	if len(publisher.sourceCalls) != 1 {
		t.Fatalf("expected one source registration, got %#v", publisher.sourceCalls)
	}
	call := publisher.sourceCalls[0]
	if call.ExternalDeviceID != 9 || call.BuildID == nil || *call.BuildID != buildID || call.ObjectKey == "" {
		t.Fatalf("unexpected Carbon registration: %#v", call)
	}
}

func TestParseVersion(t *testing.T) {
	for _, test := range []struct {
		version string
		encoded uint32
	}{
		{version: "1.2.3", encoded: 16909056},
		{version: "5.2.1", encoded: 84017408},
	} {
		version, encoded, err := ParseVersion(test.version)
		if err != nil {
			t.Fatal(err)
		}
		if version != test.version || encoded != test.encoded {
			t.Fatalf("got %q / %d, want %q / %d", version, encoded, test.version, test.encoded)
		}
	}
}

func TestParseVersionRejectsInvalidValues(t *testing.T) {
	for _, value := range []string{"1.2", "1.2.3.4", "1.2.256", "01.2.3", "a.2.3"} {
		if _, _, err := ParseVersion(value); err == nil {
			t.Fatalf("expected %q to fail", value)
		}
	}
}

func TestCreateUploadsAndPublishesLoRaWANV2Firmware(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	source, device := uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO data_sources(id,name,type,source_family,dsn_secret_ref,created_by) VALUES($1,'LoRa','http_api','lorawan_v2','env:TEST',$2)`, source, admin)
	must(`INSERT INTO devices(id,name,serial_no,device_type,status) VALUES($1,'Gateway','GW-1','gateway','active')`, device)
	must(`INSERT INTO device_source_refs(device_id,data_source_id,adapter_code,external_key) VALUES($1,$2,'lorawan_v2','GW-1')`, device, source)
	must(`INSERT INTO device_capabilities(device_id,capability_code) VALUES($1,'firmware_update')`, device)
	store := &memoryStore{}
	publisher := &fakePublisher{}
	service := NewService(db, publisher, map[string]ArtifactStore{"lorawan_v2": {Store: store, PublicURLPrefix: "https://cdn.example.test"}})
	idempotencyKey := uuid.New()
	result, err := service.Create(ctx, UploadInput{Filename: "gateway.bin", ContentType: "application/octet-stream", Version: "1.2.3", VerifyValue: "0123456789abcdef0123456789ABCDEF", SizeBytes: 4, Body: bytes.NewReader([]byte("test")), DeviceIDs: []uuid.UUID{device}, ActorAdminID: admin, IdempotencyKey: idempotencyKey})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "completed" || len(result.Targets) != 1 || result.Targets[0].UpstreamFirmwareID == nil || *result.Targets[0].UpstreamFirmwareID != 42 {
		t.Fatalf("unexpected result: %#v", result)
	}
	if string(store.data) != "test" || store.key == "" || len(publisher.calls) != 1 {
		t.Fatalf("upload or publish missing: %#v %#v", store, publisher.calls)
	}
	call := publisher.calls[0]
	if call.path != "/device/GW-1/firmware" || call.body["firmware_version"] != uint32(16909056) || call.body["verify_value"] != "0123456789abcdef0123456789ABCDEF" {
		t.Fatalf("unexpected upstream request: %#v", call)
	}
	repeated, err := service.Create(ctx, UploadInput{Filename: "ignored.bin", Version: "9.9.9", VerifyValue: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF", SizeBytes: 7, Body: bytes.NewReader([]byte("ignored")), DeviceIDs: []uuid.UUID{device}, ActorAdminID: admin, IdempotencyKey: idempotencyKey})
	if err != nil || repeated.ID != result.ID || len(publisher.calls) != 1 {
		t.Fatalf("idempotent retry created another release: %#v %v", repeated, err)
	}
}
