package export

import (
	"archive/zip"
	"bytes"
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/sources/carbon"
)

func TestDownloadTimesUseBeijing(t *testing.T) {
	ts := time.Date(2026, 10, 19, 16, 16, 37, 123000000, time.UTC)
	want := "2026-10-20 00:16:37.123"
	series := []telemetrySeries{{Code: "temp", Points: []platform.TelemetryPoint{{Timestamp: ts, Value: 1}}}}
	t.Run("xlsx", func(t *testing.T) {
		body, err := renderTelemetryXLSX(series)
		if err != nil {
			t.Fatal(err)
		}
		z, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
		if err != nil {
			t.Fatal(err)
		}
		if sheet := readZipFile(t, z, "xl/worksheets/sheet1.xml"); !strings.Contains(sheet, "<t>"+want+"</t>") {
			t.Fatal("XLSX does not contain Beijing time", sheet)
		}
	})
	t.Run("csv", func(t *testing.T) {
		body, err := renderTelemetryCSV(series)
		if err != nil || !strings.Contains(string(body), want) {
			t.Fatalf("CSV=%s err=%v", body, err)
		}
	})
	t.Run("wide csv", func(t *testing.T) {
		body, _, _, err := renderWideTelemetryCSV(series)
		if err != nil || !strings.Contains(string(body), want) {
			t.Fatalf("CSV=%s err=%v", body, err)
		}
	})
	t.Run("carbon", func(t *testing.T) {
		body, err := renderCarbonFluxCSV(uuid.New(), []carbon.CarbonFluxPoint{{PeriodAt: ts}})
		if err != nil || !strings.Contains(string(body), want) {
			t.Fatalf("CSV=%s err=%v", body, err)
		}
	})
	t.Run("image index", func(t *testing.T) {
		var buf bytes.Buffer
		writer := zip.NewWriter(&buf)
		if err := writeMediaManifestCSVNamed(writer, "image-index.csv", []mediaExportItem{{CapturedAt: ts}}); err != nil {
			t.Fatal(err)
		}
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		z, err := zip.NewReader(bytes.NewReader(buf.Bytes()), int64(buf.Len()))
		if err != nil {
			t.Fatal(err)
		}
		if body := readZipFile(t, z, "image-index.csv"); !strings.Contains(body, want) {
			t.Fatal(body)
		}
	})
}

func TestWideTimeOrderAndEquivalentOffsets(t *testing.T) {
	ts := time.Date(2026, 10, 19, 16, 0, 0, 0, time.UTC)
	body, _, count, err := renderWideTelemetryCSV([]telemetrySeries{
		{Code: "a", Points: []platform.TelemetryPoint{{Timestamp: ts.Add(time.Nanosecond), Value: 2}, {Timestamp: ts, Value: 1}}},
		{Code: "b", Points: []platform.TelemetryPoint{{Timestamp: ts.In(time.FixedZone("Beijing", 8*3600)), Value: 3}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	rows, err := csv.NewReader(bytes.NewReader(body)).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 || rows[1][0] != "2026-10-20 00:00:00" || rows[1][2] != "3" || rows[2][0] != "2026-10-20 00:00:00.000000001" {
		t.Fatalf("rows=%v count=%d", rows, count)
	}
}
