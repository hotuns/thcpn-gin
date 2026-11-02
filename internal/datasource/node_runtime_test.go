package datasource

import (
	"encoding/json"
	"testing"
	lorawanv2 "thcpn-gin/internal/datasource/sources/lorawanv2"
)

func TestNodeRuntimeIndependentOfSensorMetrics(t *testing.T) {
	var row map[string]json.RawMessage
	if err := json.Unmarshal([]byte(`{"ts":1790564703,"diams":54,"battery":3.63,"rssi":-71,"snr":10,"sd_card_rate":0.03}`), &row); err != nil {
		t.Fatal(err)
	}
	result := lorawanv2.ParseNodeRuntime("node:2", row)
	if result.SampledAt == nil || result.Battery == nil || *result.Battery != 3.63 || result.RSSI == nil || *result.RSSI != -71 || result.SNR == nil || *result.SNR != 10 || result.SDCardRate == nil || *result.SDCardRate != 3 {
		t.Fatalf("unexpected diagnostics: %+v", result)
	}
}
func TestNodeRuntimeMissingValuesAreNotZero(t *testing.T) {
	var row map[string]json.RawMessage
	_ = json.Unmarshal([]byte(`{"ts":1790564703,"battery":null,"rssi":"invalid","snr":0}`), &row)
	result := lorawanv2.ParseNodeRuntime("node:2", row)
	if result.Battery != nil || result.RSSI != nil || result.SNR == nil || *result.SNR != 0 {
		t.Fatalf("unexpected diagnostics: %+v", result)
	}
}

func TestNodeSDUsageZeroAndMissing(t *testing.T) {
	for _, value := range []string{"null", `"invalid"`, "0", "1"} {
		var row map[string]json.RawMessage
		_ = json.Unmarshal([]byte(`{"sd_card_rate":`+value+`}`), &row)
		result := lorawanv2.ParseNodeRuntime("node", row)
		if value == "0" || value == "1" {
			want := float64(0)
			if value == "1" {
				want = 100
			}
			if result.SDCardRate == nil || *result.SDCardRate != want {
				t.Fatalf("%s: %+v", value, result)
			}
		} else if result.SDCardRate != nil {
			t.Fatalf("invalid SD value became a number: %s", value)
		}
	}
}
