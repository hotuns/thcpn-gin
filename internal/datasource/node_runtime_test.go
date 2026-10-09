package datasource

import (
	"encoding/json"
	"testing"
)

func TestNodeRuntimeIndependentOfSensorMetrics(t *testing.T) {
	var row map[string]json.RawMessage
	if err := json.Unmarshal([]byte(`{"ts":1790564703,"diams":54,"battery":3.63,"rssi":-71,"snr":10}`), &row); err != nil {
		t.Fatal(err)
	}
	result := parseNodeRuntime("node:2", row)
	if result.SampledAt == nil || result.Battery == nil || *result.Battery != 3.63 || result.RSSI == nil || *result.RSSI != -71 || result.SNR == nil || *result.SNR != 10 {
		t.Fatalf("unexpected diagnostics: %+v", result)
	}
}

func TestNodeRuntimeMissingValuesAreNotZero(t *testing.T) {
	var row map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"ts":1790564703,"battery":null,"rssi":"invalid","snr":0}`), &row)
	result := parseNodeRuntime("node:2", row)
	if result.Battery != nil || result.RSSI != nil || result.SNR == nil || *result.SNR != 0 {
		t.Fatalf("unexpected diagnostics: %+v", result)
	}
}
