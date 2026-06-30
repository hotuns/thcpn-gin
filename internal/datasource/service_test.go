package datasource

import (
	"encoding/json"
	"testing"

	"thcpn-gin/internal/apperr"
)

func TestNormalizeBindingValidation(t *testing.T) {
	valid := CreateDataStreamBindingInput{
		DatabaseName:    "device_db",
		SchemaName:      "public",
		TableName:       "device_data_2026",
		DeviceKeyField:  "serial_no",
		DeviceKeyValue:  "THCPN001",
		TimeField:       "collected_at",
		ValueField:      "soil_moisture_10",
		PayloadType:     "columns",
		QueryConfigJSON: json.RawMessage(`{"timezone":"UTC"}`),
	}

	normalized, err := normalizeBinding(valid, "active")
	if err != nil {
		t.Fatalf("expected valid binding, got %v", err)
	}
	if normalized.DatabaseName == nil || *normalized.DatabaseName != "device_db" {
		t.Fatalf("unexpected database name: %#v", normalized.DatabaseName)
	}
	if string(normalized.QueryConfigJSON) != `{"timezone":"UTC"}` {
		t.Fatalf("unexpected query config: %s", normalized.QueryConfigJSON)
	}

	invalidIdentifier := valid
	invalidIdentifier.TableName = "device_data;drop"
	if _, err := normalizeBinding(invalidIdentifier, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid table name, got %v", err)
	}

	invalidJSON := valid
	invalidJSON.QueryConfigJSON = json.RawMessage(`[1,2,3]`)
	if _, err := normalizeBinding(invalidJSON, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid query config, got %v", err)
	}
}

func TestNormalizeQueryConfigDefaults(t *testing.T) {
	normalized, err := normalizeQueryConfig(nil)
	if err != nil {
		t.Fatalf("normalize empty config: %v", err)
	}
	if string(normalized) != "{}" {
		t.Fatalf("expected default object, got %s", normalized)
	}
}
