package lorawanv2

import (
	"encoding/json"
	"testing"
	"thcpn-gin/internal/apperr"
)

func TestInvalidUpstreamSensorConfigRemainsDataSourceError(t *testing.T) {
	for _, raw := range []string{
		`{"content":[["485",["0103",[["temp","0,1,0,>2i","℃"],["temp","1,1,0,>2i","℃"]]]]]}`,
		`{"content":[["485",["0103",[]]]]}`,
		`{"content":[["iic",["SHT30","0x44"]]]}`,
	} {
		if !json.Valid([]byte(raw)) {
			t.Fatalf("test fixture is not valid JSON: %s", raw)
		}
		if _, err := parseLoRaWANV2MetricUnits(json.RawMessage(raw)); apperr.KindOf(err) != apperr.KindDataSource {
			t.Fatalf("malformed source config must remain a data-source error: %v", err)
		}
	}
}
