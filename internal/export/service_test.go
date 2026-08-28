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
	"thcpn-gin/internal/datasource"
	"thcpn-gin/internal/objectstore"
)

type exportTestStore struct{ getCalls int }

func (s *exportTestStore) Delete(context.Context, string) error            { return nil }
func (s *exportTestStore) Put(context.Context, objectstore.PutInput) error { return nil }
func (s *exportTestStore) Get(context.Context, string) (objectstore.GetResult, error) {
	s.getCalls++
	return objectstore.GetResult{}, nil
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
		Points: []datasource.TelemetryPoint{{
			Timestamp: time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC),
			Value:     21.5,
			Quality:   "valid",
		}},
	}})
	if err != nil {
		t.Fatalf("render csv: %v", err)
	}
	expectedPrefix := "data_stream_id,device_id,code,name,unit,ts,value,quality\n" +
		streamID.String() + "," + deviceID.String() + ",soil_moisture_10,Soil moisture 10cm,%,2026-06-01T00:00:00Z,21.5,valid\n"
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
		Points: []datasource.TelemetryPoint{{
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
	if !strings.Contains(sheet, `<t>data_stream_id</t>`) {
		t.Fatalf("expected telemetry header in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<t>`+streamID.String()+`</t>`) {
		t.Fatalf("expected stream id in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<t>Soil &amp; &lt;moisture&gt;</t>`) {
		t.Fatalf("expected escaped stream name in sheet xml:\n%s", sheet)
	}
	if !strings.Contains(sheet, `<c r="G2"><v>21.5</v></c>`) {
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
		MediaType:    "image",
		ObjectKey:    "raw/camera/photo.jpg",
	}

	first := mediaArchivePath(item, used)
	second := mediaArchivePath(item, used)

	expectedFirst := "media/" + streamID.String() + "/image_img_001.jpg"
	expectedSecond := "media/" + streamID.String() + "/image_img_001_2.jpg"
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
