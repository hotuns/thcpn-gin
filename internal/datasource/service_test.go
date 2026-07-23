package datasource

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestNormalizeBindingValidation(t *testing.T) {
	valid := CreateDataStreamBindingInput{
		AdapterCode:       AdapterGenericColumns,
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

	normalized, err := normalizeBinding(valid, "active")
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
	if _, err := normalizeBinding(invalidIdentifier, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid table name, got %v", err)
	}

	invalidJSON := valid
	invalidJSON.AdapterConfigJSON = json.RawMessage(`[1,2,3]`)
	if _, err := normalizeBinding(invalidJSON, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid adapter config, got %v", err)
	}
}

func TestNormalizeAdapterConfigDefaults(t *testing.T) {
	normalized, err := normalizeAdapterConfig(nil)
	if err != nil {
		t.Fatalf("normalize empty config: %v", err)
	}
	if string(normalized) != "{}" {
		t.Fatalf("expected default object, got %s", normalized)
	}
}

func TestNormalizeBindingAdapterCodeRules(t *testing.T) {
	base := CreateDataStreamBindingInput{
		AdapterCode:       AdapterGenericColumns,
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
	if _, err := normalizeBinding(missingTable, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_columns missing table to fail, got %v", err)
	}

	legacy := CreateDataStreamBindingInput{
		AdapterCode:       AdapterTHCPNLegacy,
		PayloadType:       "columns",
		AdapterConfigJSON: json.RawMessage(`{"legacy_device_id":101}`),
	}
	normalizedLegacy, err := normalizeBinding(legacy, "active")
	if err != nil {
		t.Fatalf("expected thcpn legacy binding without generic mapping to pass, got %v", err)
	}
	if normalizedLegacy.TableName != nil || normalizedLegacy.DeviceKeyField != nil || normalizedLegacy.TimeField != nil {
		t.Fatalf("expected empty generic mapping for thcpn legacy binding, got %#v", normalizedLegacy)
	}

	invalidAdapter := base
	invalidAdapter.AdapterCode = "generic_mysql_columns"
	if _, err := normalizeBinding(invalidAdapter, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid adapter_code to fail, got %v", err)
	}

	genericMediaMissingConfig := CreateDataStreamBindingInput{
		AdapterCode:       AdapterGenericMedia,
		TableName:         "media_index",
		DeviceKeyField:    "serial_no",
		DeviceKeyValue:    "CAM001",
		TimeField:         "captured_at",
		PayloadType:       "media",
		AdapterConfigJSON: json.RawMessage(`{}`),
	}
	if _, err := normalizeBinding(genericMediaMissingConfig, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_media missing object_key_field to fail, got %v", err)
	}

	genericMedia := genericMediaMissingConfig
	genericMedia.AdapterConfigJSON = json.RawMessage(`{"object_key_field":"object_key"}`)
	if _, err := normalizeBinding(genericMedia, "active"); err != nil {
		t.Fatalf("expected generic_media with object_key_field to pass, got %v", err)
	}

	genericMedia.PayloadType = "columns"
	if _, err := normalizeBinding(genericMedia, "active"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected generic_media columns payload to fail, got %v", err)
	}
}

func TestValidateTHCPNDeviceSyncInput(t *testing.T) {
	actorID := uuid.New()
	workspaceID := uuid.New()
	projectID := uuid.New()
	siteID := uuid.New()

	tests := []struct {
		name  string
		input thcpnDeviceSyncInput
		want  apperr.Kind
	}{
		{
			name: "valid unassigned system asset sync",
			input: thcpnDeviceSyncInput{
				ExternalDeviceID: 101,
				ActorUserID:      actorID,
			},
		},
		{
			name: "valid assigned sync",
			input: thcpnDeviceSyncInput{
				TargetWorkspaceID: workspaceID,
				ProjectID:         &projectID,
				SiteID:            &siteID,
				ExternalDeviceID:  101,
				ActorUserID:       actorID,
			},
		},
		{
			name: "requires actor",
			input: thcpnDeviceSyncInput{
				ExternalDeviceID: 101,
			},
			want: apperr.KindInvalidArgument,
		},
		{
			name: "requires external device",
			input: thcpnDeviceSyncInput{
				ActorUserID: actorID,
			},
			want: apperr.KindInvalidArgument,
		},
		{
			name: "requires workspace when project provided",
			input: thcpnDeviceSyncInput{
				ProjectID:        &projectID,
				ExternalDeviceID: 101,
				ActorUserID:      actorID,
			},
			want: apperr.KindInvalidArgument,
		},
		{
			name: "requires project when site provided",
			input: thcpnDeviceSyncInput{
				TargetWorkspaceID: workspaceID,
				SiteID:            &siteID,
				ExternalDeviceID:  101,
				ActorUserID:       actorID,
			},
			want: apperr.KindInvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateTHCPNDeviceSyncInput(tt.input)
			if tt.want == "" {
				if err != nil {
					t.Fatalf("expected valid input, got %v", err)
				}
				return
			}
			if apperr.KindOf(err) != tt.want {
				t.Fatalf("expected %s, got %v", tt.want, err)
			}
		})
	}
}

func TestValidateTHCPNGatewaySyncInputRequiresTargetWhenAssigningNodes(t *testing.T) {
	_, err := validateTHCPNGatewaySyncInput(SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
		AssignNodes:       true,
		ActorUserID:       uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestNormalizeTHCPNConfigJSONShapes(t *testing.T) {
	if _, err := normalizeTHCPNConfigArrayJSON(json.RawMessage(`{"bad":true}`), "data_json"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected object data_json to fail, got %v", err)
	}
	if _, err := normalizeTHCPNConfigArrayJSON(json.RawMessage(`[{"key":"temp"}]`), "data_json"); err != nil {
		t.Fatalf("expected array data_json to pass, got %v", err)
	}
	if _, err := normalizeTHCPNConfigObjectJSON(json.RawMessage(`[{"bad":true}]`), "control_json"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected array control_json to fail, got %v", err)
	}
	if _, err := normalizeTHCPNConfigObjectJSON(json.RawMessage(`{"relay":true}`), "control_json"); err != nil {
		t.Fatalf("expected object control_json to pass, got %v", err)
	}
}

func TestCapabilitiesForSyncedTHCPNStreams(t *testing.T) {
	capabilities := capabilitiesForSyncedTHCPNStreams([]SyncedDataStream{
		{Type: "telemetry"},
		{Type: "image"},
	})
	seen := map[string]bool{}
	for _, capability := range capabilities {
		seen[capability] = true
	}
	for _, required := range []string{"configurable", "telemetry", "image_capture"} {
		if !seen[required] {
			t.Fatalf("expected capability %s in %#v", required, capabilities)
		}
	}
}

func TestSyncTHCPNGatewayValidatesInputBeforeDatabase(t *testing.T) {
	service := NewService(nil)

	_, err := service.SyncTHCPNGateway(context.Background(), SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
		AssignNodes:       true,
		ActorUserID:       uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument before database access, got %v", err)
	}
}

func TestSyncTHCPNGatewayRequiresDatabaseForValidInput(t *testing.T) {
	service := NewService(nil)

	_, err := service.SyncTHCPNGateway(context.Background(), SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
		ActorUserID:       uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error for missing database, got %v", err)
	}
}

func TestPlatformTHCPNDeviceType(t *testing.T) {
	if got := platformTHCPNDeviceType("10"); got != "gateway" {
		t.Fatalf("expected external type 10 to map to gateway, got %q", got)
	}
	for _, value := range []string{"", "0", "1", "19", " gateway "} {
		if got := platformTHCPNDeviceType(value); got != "standalone" {
			t.Fatalf("expected external type %q to map to standalone, got %q", value, got)
		}
	}
}

func TestSyncAllTHCPNDevicesRequiresDatabaseForValidInput(t *testing.T) {
	service := NewService(nil)
	_, err := service.SyncAllTHCPNDevices(context.Background(), SyncAllTHCPNDevicesInput{
		DataSourceID: uuid.New(),
		ActorUserID:  uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error for missing database, got %v", err)
	}
}
