package wallboard

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"thcpn-gin/internal/datasource"
)

func TestCatalogProvidesAtlas(t *testing.T) {
	items, err := catalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Code != "atlas-tech" || items[0].Scene != "organization" {
		t.Fatalf("unexpected atlas catalog: %#v", items)
	}
}

func TestAtlasConfig(t *testing.T) {
	for _, raw := range []string{`{"presentation":"analysis"}`, `{"layout":"other"}`, `{"trend_hours":721}`, `{"description":"` + strings.Repeat("字", 301) + `"}`} {
		if _, err := (&Service{}).validateConfig(context.Background(), uuid.New(), "organization", json.RawMessage(raw)); err == nil {
			t.Fatalf("accepted invalid config: %s", raw)
		}
	}
	c, err := (&Service{}).validateConfig(context.Background(), uuid.New(), "organization", json.RawMessage(`{"layout":"map","description":"科研观测","show_images":false,"show_trends":true}`))
	if err != nil || c.ShowImages == nil || *c.ShowImages || c.Layout != "map" || c.Description != "科研观测" {
		t.Fatalf("atlas config not preserved: %#v, %v", c, err)
	}
}

func TestAtlasPresentationRoundTrip(t *testing.T) {
	for _, presentation := range []string{"technology", "panorama"} {
		raw, _ := json.Marshal(Config{Presentation: presentation})
		config, err := (&Service{}).validateConfig(context.Background(), uuid.New(), "organization", raw)
		if err != nil || config.Presentation != presentation {
			t.Fatalf("presentation lost: %#v, %v", config, err)
		}
		encoded, _ := json.Marshal(config)
		var saved Config
		if err := json.Unmarshal(encoded, &saved); err != nil || saved.Presentation != presentation {
			t.Fatalf("presentation did not survive serialization: %s", encoded)
		}
	}
}

func TestAtlasRejectsInvalidNameBeforePersistence(t *testing.T) {
	for _, name := range []string{"  ", strings.Repeat("字", 121)} {
		if _, err := (&Service{}).Save(context.Background(), uuid.New(), uuid.New(), uuid.Nil, name, "atlas-tech", json.RawMessage(`{}`)); err == nil {
			t.Fatalf("accepted invalid name: %q", name)
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
	applyTemplateSettings(&item, "template-code", 2, "published", "premium", "¥9,800 / 年", "联系开通")
	if item.Code != "template-code" || item.Version != 2 || item.Status != "published" || item.Tier != "premium" || item.DisplayPrice != "¥9,800 / 年" || item.ContactCopy != "联系开通" {
		t.Fatalf("database settings were not preserved: %#v", item)
	}
}
