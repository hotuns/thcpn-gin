package export

import (
	"github.com/google/uuid"
	"strings"
	"testing"
	platform "thcpn-gin/internal/datasource/platform"
	"time"
)

func TestGatewayWideAlignsNodeAndTimestamp(t *testing.T) {
	ts := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	index := 3
	point := func(value float64) []platform.TelemetryPoint {
		return []platform.TelemetryPoint{{Timestamp: ts, Value: value}}
	}
	series := []telemetrySeries{
		{NodeKey: "gateway:GW:node:3", NodeName: "样地三", NodeIndex: &index, Code: "temp", MetricName: "温度", Unit: "℃", Points: point(20)},
		{NodeKey: "gateway:GW:node:3", NodeName: "样地三", NodeIndex: &index, Code: "battery", MetricName: "电压", Unit: "V", Points: point(3.6)},
		{NodeKey: "device:other", NodeName: "另一个节点", Code: "temp", MetricName: "温度", Unit: "℃", Points: point(15)},
	}
	rows := gatewayWideRows(series)
	if len(rows) != 3 || len(rows[0]) != 6 {
		t.Fatalf("not a node/time wide table: %v", rows)
	}
	if rows[2][0].value != "样地三" || rows[2][2].value != "3" || rows[2][4].value != "20" || rows[2][5].value != "3.6" {
		t.Fatalf("metrics not aligned: %v", rows[2])
	}
	if rows[1][5].value != "" {
		t.Fatal("missing value must remain empty")
	}
	csv, err := renderTelemetryCSV(series)
	if err != nil || !strings.Contains(string(csv), "2026-10-29 08:00:00") {
		t.Fatalf("Beijing time missing: %s %v", csv, err)
	}
	xml := xlsxTelemetrySheetXML(series)
	if !strings.Contains(xml, "节点名称") || !strings.Contains(xml, "autoFilter") || strings.Contains(xml, "data_stream_id") {
		t.Fatal("xlsx is still a long table")
	}
}

func TestGenericDownloadsAreWideAndSeparateDevices(t *testing.T) {
	ts := time.Now().UTC()
	first, second := uuid.New(), uuid.New()
	data := []telemetrySeries{
		{DeviceID: first, Code: "temp", Name: "温度", Points: []platform.TelemetryPoint{{Timestamp: ts, Value: 10, Quality: "valid"}}},
		{DeviceID: first, Code: "humidity", Name: "湿度", Points: []platform.TelemetryPoint{{Timestamp: ts, Value: 50}}},
		{DeviceID: second, Code: "temp", Name: "温度", Points: []platform.TelemetryPoint{{Timestamp: ts, Value: 20}}},
	}
	rows := gatewayWideRows(data)
	if len(rows) != 3 || len(rows[0]) != 7 {
		t.Fatalf("generic export must be wide: %v", rows)
	}
	for _, row := range rows[1:] {
		if row[1].value == first.String() && (row[4].value != "10" || row[5].value != "50" || row[6].value != "valid") {
			t.Fatalf("lost aligned data/quality: %v", row)
		}
		if row[1].value == second.String() && row[5].value != "" {
			t.Fatal("different devices mixed")
		}
	}
}
