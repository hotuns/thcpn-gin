package export

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/auth"
	"thcpn-gin/internal/config"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/objectstore"
	"thcpn-gin/internal/testdb"
)

type exportTestStore struct{ getCalls int }

func (s *exportTestStore) Delete(context.Context, string) error            { return nil }
func (s *exportTestStore) Put(context.Context, objectstore.PutInput) error { return nil }
func (s *exportTestStore) Get(context.Context, string) (objectstore.GetResult, error) {
	s.getCalls++
	return objectstore.GetResult{}, nil
}

func TestDemoExportResolvesBeforeCreateWithoutRealAssignment(t *testing.T) {
	db := testdb.Open(t, 0)
	ctx := t.Context()
	admin := testdb.Admin(t, db)
	demo, user, demoWorkspace, realWorkspace, device, telemetry, media := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	must := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	must(`INSERT INTO users(id,name,username,is_demo) VALUES($1,'Demo','export-demo',true)`, demo)
	must(`INSERT INTO users(id,name,email) VALUES($1,'Owner','export-owner@example.test')`, user)
	must(`INSERT INTO workspaces(id,type,name,owner_user_id,is_demo_workspace) VALUES($1,'personal','Demo',$2,true),($3,'personal','Real',$4,false)`, demoWorkspace, demo, realWorkspace, user)
	must(`INSERT INTO devices(id,name,device_type) VALUES($1,'Selected station','standalone')`, device)
	must(`INSERT INTO demo_showcase_devices(user_id,workspace_id,device_id,added_by) VALUES($1,$2,$3,$4)`, demo, demoWorkspace, device, admin)
	must(`INSERT INTO data_streams(id,device_id,code,name,type,created_by,created_by_type) VALUES($1,$2,'temp','Temperature','telemetry',$3,'system_admin'),($4,$2,'image','Image','image',$3,'system_admin')`, telemetry, device, admin, media)
	svc := NewService(db, nil, config.ExportConfig{})
	demoCtx := auth.WithActor(ctx, auth.Actor{UserID: demo, IsDemo: true})
	userCtx := auth.WithActor(ctx, auth.Actor{UserID: user})
	for _, assigned := range []bool{false, true} {
		if assigned {
			must(`INSERT INTO device_assignments(device_id,workspace_id) VALUES($1,$2)`, device, realWorkspace)
		}
		for _, resource := range []struct {
			kind, exportType string
			id               uuid.UUID
		}{{"device", "telemetry_csv", device}, {"data_stream", "telemetry_csv", telemetry}, {"media", "media_zip", media}} {
			resolved, err := svc.Resolve(demoCtx, resource.kind, resource.id, resource.exportType)
			if err != nil || resolved.WorkspaceID != demoWorkspace {
				t.Fatalf("demo resolve assigned=%t type=%s: %#v %v", assigned, resource.kind, resolved, err)
			}
			for _, ordinaryCtx := range []context.Context{ctx, userCtx} {
				resolved, err = svc.Resolve(ordinaryCtx, resource.kind, resource.id, resource.exportType)
				if (!assigned && apperr.KindOf(err) != apperr.KindNotFound) || (assigned && (err != nil || resolved.WorkspaceID != realWorkspace)) {
					t.Fatalf("ordinary/background resolve: %#v %v", resolved, err)
				}
			}
			// Jobs also originate without an HTTP actor. RequestedBy must still
			// select the demo workspace before any real-assignment requirement.
			input := CreateInput{ResourceType: resource.kind, ResourceID: resource.id, ExportType: resource.exportType, RequestedBy: demo, RequestConfig: json.RawMessage(`{"start_time":"2026-06-01T00:00:00Z","end_time":"2026-06-02T00:00:00Z"}`)}
			job, resolved, err := svc.Create(ctx, input)
			if err != nil || job.WorkspaceID != demoWorkspace || job.RequestedBy != demo || resolved.WorkspaceID != demoWorkspace {
				t.Fatalf("demo create without actor: %#v %#v %v", job, resolved, err)
			}
			input.RequestedBy = user
			job, _, err = svc.Create(demoCtx, input)
			if (!assigned && apperr.KindOf(err) != apperr.KindNotFound) || (assigned && (err != nil || job.WorkspaceID != realWorkspace || job.RequestedBy != user)) {
				t.Fatalf("explicit ordinary requester must own workspace: %#v %v", job, err)
			}
		}
	}
	must(`DELETE FROM demo_showcase_devices WHERE device_id=$1`, device)
	if _, err := svc.Resolve(demoCtx, "data_stream", telemetry, "telemetry_csv"); apperr.KindOf(err) != apperr.KindPermissionDenied {
		t.Fatalf("unselected export must remain denied: %v", err)
	}
}

func TestResolveAction(t *testing.T) {
	action, resourceType, err := resolveAction("device", "telemetry_csv")
	if err != nil {
		t.Fatalf("telemetry action: %v", err)
	}
	if action != ActionTelemetryExport || resourceType != "device" {
		t.Fatalf("unexpected telemetry policy: %s/%s", action, resourceType)
	}

	action, resourceType, err = resolveAction("dataset", "dataset_zip")
	if err != nil {
		t.Fatalf("dataset action: %v", err)
	}
	if action != ActionDatasetExport || resourceType != "dataset" {
		t.Fatalf("unexpected dataset policy: %s/%s", action, resourceType)
	}

	action, resourceType, err = resolveAction("media", "media_zip")
	if err != nil {
		t.Fatalf("media action: %v", err)
	}
	if action != ActionMediaDownload || resourceType != "data_stream" {
		t.Fatalf("unexpected media policy: %s/%s", action, resourceType)
	}

	if _, _, err := resolveAction("dataset", "telemetry_csv"); err == nil {
		t.Fatal("expected incompatible telemetry export to fail")
	}
}

func TestParseRequestConfig(t *testing.T) {
	cfg, err := parseRequestConfig(json.RawMessage(`{
		"start_time": "2026-06-01T00:00:00Z",
		"end_time": "2026-06-02T00:00:00Z",
		"limit": 5
	}`), 100)
	if err != nil {
		t.Fatalf("parse request config: %v", err)
	}
	if cfg.Limit != 5 {
		t.Fatalf("unexpected limit: %d", cfg.Limit)
	}
	if !cfg.EndTime.After(cfg.StartTime) {
		t.Fatal("expected end_time after start_time")
	}

	_, err = parseRequestConfig(json.RawMessage(`{"start_time":"2026-06-02T00:00:00Z"}`), 100)
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected missing end_time to be invalid, got %v", err)
	}
}

func TestRenderTelemetryCSV(t *testing.T) {
	streamID := uuid.New()
	deviceID := uuid.New()
	body, err := renderTelemetryCSV([]telemetrySeries{{
		DataStreamID: streamID,
		DeviceID:     deviceID,
		Code:         "soil_moisture_10",
		Name:         "Soil moisture 10cm",
		Unit:         "%",
		Points: []platform.TelemetryPoint{{
			Timestamp: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
			Value:     21.5,
			Quality:   "valid",
		}},
	}})
	if err != nil {
		t.Fatalf("render csv: %v", err)
	}
	expectedPrefix := "设备名称,设备ID,节点序号,时间（北京时间）,Soil moisture 10cm [soil_moisture_10] (%),Soil moisture 10cm [soil_moisture_10] 质量\n" +
		"," + deviceID.String() + ",,2026-06-01 08:00:00,21.5,valid\n"
	if string(body) != expectedPrefix {
		t.Fatalf("unexpected csv:\n%s", body)
	}
}

func TestRenderWideTelemetryCSVUsesStreamNames(t *testing.T) {
	body, _, _, err := renderWideTelemetryCSV([]telemetrySeries{
		{Code: "temp", Name: "空气温度"},
		{Code: "press", Name: "气压"},
	})
	if err != nil {
		t.Fatalf("render wide csv: %v", err)
	}
	if got, want := strings.SplitN(string(body), "\n", 2)[0], "ts,气压,空气温度"; got != want {
		t.Fatalf("unexpected wide csv header: got %q want %q", got, want)
	}
}

func TestRenderTelemetryXLSX(t *testing.T) {
	streamID := uuid.New()
	deviceID := uuid.New()
	body, err := renderTelemetryXLSX([]telemetrySeries{{
		DataStreamID: streamID,
		DeviceID:     deviceID,
		Code:         "soil_moisture_10",
		Name:         "Soil & <moisture>",
		Unit:         "%",
		Points: []platform.TelemetryPoint{{
			Timestamp: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
			Value:     21.5,
			Quality:   "valid",
		}},
	}})
	if err != nil {
		t.Fatalf("render xlsx: %v", err)
	}

	reader, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
	if err != nil {
		t.Fatalf("open xlsx zip: %v", err)
	}
	sheet := readZipFile(t, reader, "xl/worksheets/sheet1.xml")
	if !strings.Contains(sheet, `<t>设备ID</t>`) {
		t.Fatalf("expected telemetry header in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<t>`+deviceID.String()+`</t>`) {
		t.Fatalf("expected stream id in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<t>Soil &amp; &lt;moisture&gt; [soil_moisture_10] (%)</t>`) {
		t.Fatalf("expected escaped stream name in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<c r="E2"><v>21.5</v></c>`) {
		t.Fatalf("expected numeric value cell in sheet xml:\n%s", sheet)
	}
	if workbook := readZipFile(t, reader, "xl/workbook.xml"); !strings.Contains(workbook, `name="telemetry"`) {
		t.Fatalf("expected telemetry sheet in workbook xml:\n%s", workbook)
	}
}

func TestMediaArchivePathSanitizesAndDeduplicates(t *testing.T) {
	streamID := uuid.New()
	used := map[string]int{}
	item := mediaExportItem{
		DataStreamID: streamID,
		MediaID:      "img/001",
		CameraName:   "可见光/相机",
		CapturedAt:   time.Date(2026, 9, 15, 0, 11, 4, 123456789, time.UTC),
		MediaType:    "image",
		ObjectKey:    "raw/camera/photo.jpg",
	}

	first := mediaArchivePath(item, used)
	second := mediaArchivePath(item, used)

	expectedFirst := "可见光_相机/2026-09-15_08-11-04.123456789.jpg"
	expectedSecond := "可见光_相机/2026-09-15_08-11-04.123456789_2.jpg"
	if first != expectedFirst || second != expectedSecond {
		t.Fatalf("unexpected archive paths: %q %q", first, second)
	}
}

func TestFetchMediaObjectDownloadsAbsoluteURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("image-body"))
	}))
	defer server.Close()
	store := &exportTestStore{}
	result, err := fetchMediaObject(t.Context(), store, server.Client(), server.URL+"/1206/photo.jpg")
	if err != nil {
		t.Fatalf("fetch media object: %v", err)
	}
	defer result.Body.Close()
	body, err := io.ReadAll(result.Body)
	if err != nil {
		t.Fatalf("read media object: %v", err)
	}
	if string(body) != "image-body" {
		t.Fatalf("unexpected media body: %q", body)
	}
	if store.getCalls != 0 {
		t.Fatalf("absolute URL must not be passed to object store, got %d calls", store.getCalls)
	}
}

func readZipFile(t *testing.T, reader *zip.Reader, name string) string {
	t.Helper()
	for _, file := range reader.File {
		if file.Name != name {
			continue
		}
		rc, err := file.Open()
		if err != nil {
			t.Fatalf("open zip file %s: %v", name, err)
		}
		defer rc.Close()
		body, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read zip file %s: %v", name, err)
		}
		return string(body)
	}
	t.Fatalf("missing zip file %s", name)
	return ""
}

func TestMediaArchivePathUsesCaptureTimeAndURLPath(t *testing.T) {
	item := mediaExportItem{CameraName: "近红外", CapturedAt: time.Date(2026, 9, 15, 23, 59, 59, 0, time.UTC), ObjectKey: "https://example.test/photo.JPG?signature=a.b"}
	got := mediaArchivePath(item, map[string]int{})
	if got != "近红外/2026-09-16_07-59-59.jpg" {
		t.Fatalf("unexpected archive path: %s", got)
	}
}
