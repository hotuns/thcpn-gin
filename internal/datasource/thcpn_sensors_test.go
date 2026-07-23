package datasource

import (
	"encoding/json"
	"testing"
)

func TestDecodeFlexibleJSON(t *testing.T) {
	for _, raw := range []string{`[0,1,2,3]`, `"[0,1,2,3]"`} {
		var ports []int
		if err := decodeFlexibleJSON(raw, &ports); err != nil {
			t.Fatalf("decode %s: %v", raw, err)
		}
		if len(ports) != 4 || ports[3] != 3 {
			t.Fatalf("unexpected ports for %s: %#v", raw, ports)
		}
	}
	var invalid []int
	if err := decodeFlexibleJSON(`not-json`, &invalid); err == nil {
		t.Fatal("expected invalid JSON to fail")
	}
}

func TestSensorMetricsFromHCD6818Params(t *testing.T) {
	raw := `{"command":"ff0300070007a017","contents":[{"key":"temp","info":{"max":85,"min":-40,"name":"空气温度","type":"temp","unit":"℃","index":0},"decode":"2,0.01,40,>2u"},{"key":"humi","info":{"max":100,"min":0,"name":"相对湿度","type":"humi","unit":"%","index":1},"decode":"3,0.01,0,>2u"},{"key":"press","info":{"max":1100,"min":500,"name":"气压","type":"pressure","unit":"hpa","index":2},"decode":"4,0.1,0,>2u"},{"key":"wind_sp","info":{"max":60,"min":0,"name":"风速","type":"wind_speed","unit":"m/s","index":3},"decode":"5,0.01,0,>2u"},{"key":"wind_d","info":{"max":359.9,"min":0,"name":"风向","type":"wind_direction","unit":"°","index":4},"decode":"6,0.1,0,>2u"},{"key":"pm2.5","info":{"max":1000,"min":0,"name":"PM2.5","unit":"ug/m³","index":5},"decode":"0,1,0,>2u"},{"key":"pm10","info":{"max":1000,"min":0,"name":"PM10","unit":"ug/m³","index":6},"decode":"1,1,0,>2u"}],"wait_time":60}`
	var params map[string]any
	if err := json.Unmarshal([]byte(raw), &params); err != nil {
		t.Fatal(err)
	}
	metrics := sensorMetricsFromParams(params)
	if len(metrics) != 7 {
		t.Fatalf("expected 7 metrics, got %d", len(metrics))
	}
	if metrics[0].Key != "temp" || metrics[0].Name != "空气温度" || metrics[0].Unit != "℃" || metrics[0].Decode != "2,0.01,40,>2u" {
		t.Fatalf("unexpected first metric: %#v", metrics[0])
	}
}

func TestBuildSensorTemplateWhere(t *testing.T) {
	where, args := buildSensorTemplateWhere(THCPNSensorTemplateListInput{Search: "HCD", Port: "485", Driver: "modbusrtu"})
	if where != " WHERE deleted_at IS NULL AND (sensor_type LIKE ? OR description LIKE ? OR sensor LIKE ?) AND port = ? AND sensor = ?" {
		t.Fatalf("unexpected where: %s", where)
	}
	if len(args) != 5 || args[0] != "%HCD%" || args[4] != "modbusrtu" {
		t.Fatalf("unexpected args: %#v", args)
	}
}

func TestSummarizeTHCPNConfigChange(t *testing.T) {
	previous := thcpnExternalConfig{
		ID:      41,
		Data:    json.RawMessage(`[{"sensorType":"A","params":{"contents":[{"key":"temp"}]}}]`),
		Image:   json.RawMessage(`[{"key":"key1"}]`),
		Control: json.RawMessage(`{"data_capture_invl":"0 *"}`),
	}
	summary := summarizeTHCPNConfigChange(
		previous,
		json.RawMessage(`[{"params":{"contents":[{"key":"temp"},{"key":"humi"}]}},{"params":{"contents":[]}}]`),
		json.RawMessage(`[{"key":"key1"}]`),
		json.RawMessage(`{"data_capture_invl":"0,30 *"}`),
	)
	if summary.PreviousConfigID != 41 || summary.SensorCount != 2 || summary.MetricCount != 2 || summary.ImageCount != 1 {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if len(summary.ChangedSections) != 2 || summary.ChangedSections[0] != "data_json" || summary.ChangedSections[1] != "control_json" {
		t.Fatalf("unexpected changed sections: %#v", summary.ChangedSections)
	}
}
