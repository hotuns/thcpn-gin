package export

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource"
)

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
