package processing

import (
	"encoding/json"
	"testing"
)

func TestValidatePlanParameters(t *testing.T) {
	manifest := json.RawMessage(`{"parameters":{"type":"object","required":["threshold"],"properties":{"threshold":{"type":"number"},"enabled":{"type":"boolean"}},"additionalProperties":false}}`)
	for _, test := range []struct {
		name       string
		parameters string
		wantError  bool
	}{
		{name: "valid", parameters: `{"threshold":0.5,"enabled":true}`},
		{name: "missing required", parameters: `{"enabled":true}`, wantError: true},
		{name: "wrong type", parameters: `{"threshold":"0.5"}`, wantError: true},
		{name: "unknown parameter", parameters: `{"threshold":0.5,"formula":"x"}`, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validatePlanParameters(manifest, json.RawMessage(test.parameters))
			if (err != nil) != test.wantError {
				t.Fatalf("validatePlanParameters() error = %v, wantError %v", err, test.wantError)
			}
		})
	}
}
