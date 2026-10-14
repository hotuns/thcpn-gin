package datasource

import "testing"

func TestLoRaWANV2SensorWaitTimeValidation(t *testing.T) {
	for _, value := range []any{0, 10, 65535, 1.5, -1, 65536, "10", nil} {
		body := map[string]any{"mode": "advanced", "wait_time": value, "content": []any{[]any{"iic", []any{"SHT30", "0x44", []any{"humidity"}}}}, "metrics": []any{map[string]any{"key": "humidity", "name": "湿度"}}}
		config, err := (&Service{}).compileLoRaWANV2NodeConfig(t.Context(), body)
		if expected, ok := value.(int); ok && expected >= 0 && expected <= 65535 {
			if err != nil || config.WaitTime != expected {
				t.Fatalf("wait_time %v changed: %d %v", value, config.WaitTime, err)
			}
		} else if err == nil {
			t.Fatalf("invalid wait_time accepted: %v", value)
		}
	}
}
