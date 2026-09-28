package datasource

import "testing"

func TestNodeMetricRangePreservedAndValidated(t *testing.T) {
	for _, test := range []struct {
		min, max any
		valid    bool
	}{
		{float64(0), float64(100), true}, {nil, nil, true}, {float64(2), float64(1), false}, {"zero", float64(100), false},
	} {
		result, err := (&Service{}).compileLoRaWANV2NodeConfig(t.Context(), map[string]any{
			"mode": "advanced", "content": []any{[]any{"iic", []any{"SHT30", "0x44", []any{"humidity"}}}},
			"metrics": []any{map[string]any{"key": "humidity", "name": "湿度", "min": test.min, "max": test.max}},
		})
		if (err == nil) != test.valid {
			t.Fatalf("range %v..%v: %v", test.min, test.max, err)
		}
		if test.valid && test.min != nil && (result.Metrics[0].Min == nil || *result.Metrics[0].Min != test.min.(float64)) {
			t.Fatal("minimum lost")
		}
		if test.valid && test.max != nil && (result.Metrics[0].Max == nil || *result.Metrics[0].Max != test.max.(float64)) {
			t.Fatal("maximum lost")
		}
	}
}
