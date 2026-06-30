package device

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

func TestCreateRequiresSerialNo(t *testing.T) {
	service := NewService(nil)

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		Name:        "Station 1",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestCreateRequiresProjectWhenSiteSet(t *testing.T) {
	service := NewService(nil)
	siteID := uuid.New()

	_, err := service.Create(context.Background(), CreateInput{
		WorkspaceID: uuid.New(),
		SiteID:      &siteID,
		SerialNo:    "SN001",
		Name:        "Station 1",
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestCapabilityValidation(t *testing.T) {
	capabilities, err := normalizeCapabilities([]string{"telemetry", "telemetry", "image_capture", ""})
	if err != nil {
		t.Fatalf("expected capabilities to be valid: %v", err)
	}
	if len(capabilities) != 2 {
		t.Fatalf("expected duplicate capabilities to be removed, got %v", capabilities)
	}

	_, err = normalizeCapabilities([]string{"raw_sql"})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid capability to be rejected, got %v", err)
	}
}

func TestDeviceStatusValidation(t *testing.T) {
	for _, status := range []string{"active", "disabled", "retired"} {
		if !isValidDeviceStatus(status) {
			t.Fatalf("expected %q to be valid", status)
		}
	}
	if isValidDeviceStatus("archived") {
		t.Fatal("archived should not be a valid device status")
	}
}

func TestBuildCalibrationRequest(t *testing.T) {
	raw, err := buildCalibrationRequest(" zero_point ", json.RawMessage(`{"target":0,"unit":"ppm"}`))
	if err != nil {
		t.Fatalf("build calibration request: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if got["calibration_type"] != "zero_point" {
		t.Fatalf("unexpected calibration type: %#v", got["calibration_type"])
	}
	parameters, ok := got["parameters"].(map[string]any)
	if !ok || parameters["unit"] != "ppm" {
		t.Fatalf("unexpected parameters: %#v", got["parameters"])
	}
}

func TestBuildCalibrationRequestValidatesParameters(t *testing.T) {
	_, err := buildCalibrationRequest("zero_point", json.RawMessage(`[1,2,3]`))
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for non-object parameters, got %v", err)
	}

	_, err = buildCalibrationRequest("", nil)
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing calibration type, got %v", err)
	}
}

func TestBuildFirmwareUpgradeRequest(t *testing.T) {
	scheduledAt := time.Date(2026, 7, 1, 12, 0, 0, 0, time.FixedZone("UTC+8", 8*60*60))
	raw, err := buildFirmwareUpgradeRequest(FirmwareUpgradeInput{
		FirmwareVersion: " 1.2.3 ",
		PackageURI:      " s3://firmware/device-1.2.3.bin ",
		Checksum:        " sha256:abc ",
		ScheduledAt:     &scheduledAt,
	})
	if err != nil {
		t.Fatalf("build firmware upgrade request: %v", err)
	}

	var got map[string]string
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if got["firmware_version"] != "1.2.3" {
		t.Fatalf("unexpected firmware version: %#v", got["firmware_version"])
	}
	if got["package_uri"] != "s3://firmware/device-1.2.3.bin" || got["checksum"] != "sha256:abc" {
		t.Fatalf("unexpected firmware package metadata: %#v", got)
	}
	if got["scheduled_at"] != "2026-07-01T04:00:00Z" {
		t.Fatalf("expected scheduled_at to be normalized to UTC, got %q", got["scheduled_at"])
	}
}

func TestBuildFirmwareUpgradeRequestRequiresVersion(t *testing.T) {
	_, err := buildFirmwareUpgradeRequest(FirmwareUpgradeInput{})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument, got %v", err)
	}
}

func TestDeviceOperationValidation(t *testing.T) {
	if !isValidDeviceOperationType("calibration") || !isValidDeviceOperationType("firmware_upgrade") {
		t.Fatal("expected known operation types to be valid")
	}
	if isValidDeviceOperationType("remote_shell") {
		t.Fatal("remote_shell should not be a valid device operation type")
	}
	if !hasCapability([]string{"telemetry", "calibratable"}, "calibratable") {
		t.Fatal("expected required capability to be detected")
	}
	if hasCapability([]string{"telemetry"}, "firmware_update") {
		t.Fatal("unexpected firmware capability")
	}
}

func TestTransferRequiresDatasetPolicyConfirmation(t *testing.T) {
	service := NewService(nil)

	_, err := service.Transfer(context.Background(), TransferInput{
		DeviceID:          uuid.New(),
		TargetWorkspaceID: uuid.New(),
		ActorUserID:       uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing confirmation, got %v", err)
	}
}

func TestTransferRejectsHistoricalDatasetTransfer(t *testing.T) {
	service := NewService(nil)

	_, err := service.Transfer(context.Background(), TransferInput{
		DeviceID:                   uuid.New(),
		TargetWorkspaceID:          uuid.New(),
		TransferHistoricalDatasets: true,
		ConfirmDatasetPolicy:       true,
		ActorUserID:                uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for historical dataset transfer, got %v", err)
	}
}

func TestTransferRequiresProjectWhenSiteSet(t *testing.T) {
	service := NewService(nil)
	siteID := uuid.New()

	_, err := service.Transfer(context.Background(), TransferInput{
		DeviceID:             uuid.New(),
		TargetWorkspaceID:    uuid.New(),
		SiteID:               &siteID,
		ConfirmDatasetPolicy: true,
		ActorUserID:          uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for site without project, got %v", err)
	}
}
