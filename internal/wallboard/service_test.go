package wallboard

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/datasource"
)

func TestCatalogIncludesStableInitialTemplates(t *testing.T) {
	items, err := catalog()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"device-monitoring": "device-monitoring-v1",
		"fleet-overview":    "fleet-overview-v1",
	}
	if len(items) != len(want) {
		t.Fatalf("got %d templates, want %d", len(items), len(want))
	}
	for _, item := range items {
		if item.Version != 1 || want[item.Code] != item.ComponentKey {
			t.Fatalf("unexpected template: %#v", item)
		}
		if len(item.ConfigSchema) == 0 || len(item.SampleData) == 0 {
			t.Fatalf("template %s is missing schema or sample data", item.Code)
		}
	}
}

func TestOrganizationConfigRejectsMoreThanFiftyDevices(t *testing.T) {
	ids := make([]uuid.UUID, 51)
	for i := range ids {
		ids[i] = uuid.New()
	}
	raw, _ := json.Marshal(Config{DeviceIDs: ids})
	_, err := (&Service{}).validateConfig(context.Background(), uuid.New(), "organization", raw)
	if err == nil {
		t.Fatal("expected more than 50 devices to be rejected")
	}
}

func TestNumericAttribute(t *testing.T) {
	value := numericAttribute(datasource.THCPNAttributeValue{RawValue: " 78.5 "})
	if value == nil || *value != 78.5 {
		t.Fatalf("unexpected numeric attribute: %v", value)
	}
	if numericAttribute(datasource.THCPNAttributeValue{RawValue: "unknown"}) != nil {
		t.Fatal("invalid numeric attribute should be nil")
	}
}

func TestApplyRuntimeKeepsDemoSiteLocation(t *testing.T) {
	deviceID := uuid.New()
	siteLatitude, siteLongitude := 39.9, 116.4
	deviceLatitude, deviceLongitude := 31.2, 121.5
	snapshot := Snapshot{Devices: []Device{{ID: deviceID, Latitude: &siteLatitude, Longitude: &siteLongitude, DemoSiteLocation: true}}}
	applyRuntime(&snapshot, datasource.THCPNDeviceRuntimeBatchResponse{Items: []datasource.THCPNLatestAttributesResponse{{
		DeviceID:     deviceID,
		SourceDevice: datasource.THCPNExternalDeviceMetadata{Latitude: &deviceLatitude, Longitude: &deviceLongitude},
	}}})
	if snapshot.Devices[0].Latitude != &siteLatitude || snapshot.Devices[0].Longitude != &siteLongitude || snapshot.Devices[0].LocationSource != "site" {
		t.Fatalf("demo site location was overwritten: %#v", snapshot.Devices[0])
	}
}

func TestApplyTemplateSettingsOverridesManifestManagementFields(t *testing.T) {
	item := Template{Code: "manifest-code", Version: 1, Status: "", Tier: "", DisplayPrice: "", ContactCopy: ""}
	applyTemplateSettings(&item, "device-monitoring", 2, "published", "premium", "¥9,800 / 年", "联系开通")
	if item.Code != "device-monitoring" || item.Version != 2 || item.Status != "published" || item.Tier != "premium" || item.DisplayPrice != "¥9,800 / 年" || item.ContactCopy != "联系开通" {
		t.Fatalf("database settings were not preserved: %#v", item)
	}
}
