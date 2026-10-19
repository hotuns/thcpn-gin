package datasource

import (
	"encoding/json"
	"testing"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	thcpn "thcpn-gin/internal/datasource/sources/thcpn"
)

func TestNormalizeBindingValidation(t *testing.T) {
	valid := platform.CreateDataStreamBindingInput{
		AdapterCode:       platform.AdapterGenericColumns,
		DatabaseName:      "device_db",
		SchemaName:        "public",
		TableName:         "device_data_2026",
		DeviceKeyField:    "serial_no",
		DeviceKeyValue:    "THCPN001",
		TimeField:         "collected_at",
		ValueField:        "soil_moisture_10",
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{"timezone":"UTC"}`),
	}

	normalized, err := platform.NormalizeBinding(valid, "active")
	if err != nil {
		t.Fatalf("expected valid binding, got %v", err)
	}
	if normalized.DatabaseName == nil || *normalized.DatabaseName != "device_db" {
		t.Fatalf("unexpected database name: %#v", normalized.DatabaseName)
	}
	if string(normalized.AdapterConfigJSON) != `{"timezone":"UTC"}` {
		t.Fatalf("unexpected adapter config: %s", normalized.AdapterConfigJSON)
	}

	invalidIdentifier := valid
	invalidIdentifier.TableName = "device_data;drop"
	if _, err := platform.NormalizeBinding(invalidIdentifier, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid table name, got %v", err)
	}

	invalidJSON := valid
	invalidJSON.AdapterConfigJSON = json.RawMessage(`[1,2,3]`)
	if _, err := platform.NormalizeBinding(invalidJSON, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid adapter config, got %v", err)
	}
}
func TestNormalizeAdapterConfigDefaults(t *testing.T) {
	normalized, err := platform.NormalizeAdapterConfig(nil)
	if err != nil {
		t.Fatalf("normalize empty config: %v", err)
	}
	if string(normalized) != "{}" {
		t.Fatalf("expected default object, got %s", normalized)
	}
}
func TestNormalizeSourceFamily(t *testing.T) {
	carbon := " carbon "
	got, err := NewService(nil).Catalog.NormalizeSourceFamily(&carbon)
	if err != nil || got == nil || *got != platform.SourceFamilyCarbon {
		t.Fatalf("normalize carbon source family = %#v, %v", got, err)
	}

	empty := " "
	got, err = NewService(nil).Catalog.NormalizeSourceFamily(&empty)
	if err != nil || got != nil {
		t.Fatalf("normalize empty source family = %#v, %v", got, err)
	}

	invalid := "legacy"
	if _, err := NewService(nil).Catalog.NormalizeSourceFamily(&invalid); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid source family error, got %v", err)
	}
}
func TestNormalizeBindingAdapterCodeRules(t *testing.T) {
	base := platform.CreateDataStreamBindingInput{
		AdapterCode:       platform.AdapterGenericColumns,
		TableName:         "device_data_2026",
		DeviceKeyField:    "serial_no",
		DeviceKeyValue:    "THCPN001",
		TimeField:         "collected_at",
		ValueField:        "soil_moisture_10",
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{}`),
	}

	missingTable := base
	missingTable.TableName = ""
	if _, err := platform.NormalizeBinding(missingTable, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_columns missing table to fail, got %v", err)
	}

	legacy := platform.CreateDataStreamBindingInput{
		AdapterCode:       platform.AdapterTHCPNLegacy,
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{"legacy_device_id":101}`),
	}
	normalizedLegacy, err := platform.NormalizeBinding(legacy, "active", thcpn.BindingDefinition())
	if err != nil {
		t.Fatalf("expected thcpn legacy binding without generic mapping to pass, got %v", err)
	}
	if normalizedLegacy.TableName != nil || normalizedLegacy.DeviceKeyField != nil || normalizedLegacy.TimeField != nil {
		t.Fatalf("expected empty generic mapping for thcpn legacy binding, got %#v", normalizedLegacy)
	}

	invalidAdapter := base
	invalidAdapter.AdapterCode = "generic_mysql_columns"
	if _, err := platform.NormalizeBinding(invalidAdapter, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid adapter_code to fail, got %v", err)
	}

	genericMediaMissingConfig := platform.CreateDataStreamBindingInput{
		AdapterCode:       platform.AdapterGenericMedia,
		TableName:         "media_index",
		DeviceKeyField:    "serial_no",
		DeviceKeyValue:    "CAM001",
		TimeField:         "captured_at",
		PayloadType:       "media",
		AdapterConfigJSON: json.RawMessage(`{}`),
	}
	if _, err := platform.NormalizeBinding(genericMediaMissingConfig, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_media missing object_key_field to fail, got %v", err)
	}

	genericMedia := genericMediaMissingConfig
	genericMedia.AdapterConfigJSON = json.RawMessage(`{"object_key_field":"object_key"}`)
	if _, err := platform.NormalizeBinding(genericMedia, "active"); err != nil {
		t.Fatalf("expected generic_media with object_key_field to pass, got %v", err)
	}

	genericMedia.PayloadType = "columns"
	if _, err := platform.NormalizeBinding(genericMedia, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_media columns payload to fail, got %v", err)
	}
}
