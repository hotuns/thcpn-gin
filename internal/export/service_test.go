package export

import (
	"testing"
)

func TestResolveAction(t *testing.T) {
	action, resourceType, err := resolveAction("device", "telemetry_csv")
	if err != nil {
		t.Fatalf("telemetry action: %v", err)
	}
	if action != ActionTelemetryExport || resourceType != "device" {
		t.Fatalf("unexpected telemetry policy: %s/%s", action, resourceType)
	}

	action, resourceType, err = resolveAction("dataset", "dataset_zip")
	if err != nil {
		t.Fatalf("dataset action: %v", err)
	}
	if action != ActionDatasetExport || resourceType != "dataset" {
		t.Fatalf("unexpected dataset policy: %s/%s", action, resourceType)
	}

	action, resourceType, err = resolveAction("media", "media_zip")
	if err != nil {
		t.Fatalf("media action: %v", err)
	}
	if action != ActionMediaDownload || resourceType != "data_stream" {
		t.Fatalf("unexpected media policy: %s/%s", action, resourceType)
	}

	if _, _, err := resolveAction("dataset", "telemetry_csv"); err == nil {
		t.Fatal("expected incompatible telemetry export to fail")
	}
}
