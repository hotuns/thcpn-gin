package device

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
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

func TestUnbindRequiresActor(t *testing.T) {
	service := NewService(nil)

	err := service.Unbind(context.Background(), UnbindInput{
		DeviceID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing actor, got %v", err)
	}
}

func TestUnbindRequiresDevice(t *testing.T) {
	service := NewService(nil)

	err := service.Unbind(context.Background(), UnbindInput{
		ActorUserID: uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument for missing device, got %v", err)
	}
}

func TestAssignValidation(t *testing.T) {
	service := NewService(nil)
	siteID := uuid.New()

	tests := []struct {
		name  string
		input AssignInput
	}{
		{
			name: "requires device",
			input: AssignInput{
				TargetWorkspaceID: uuid.New(),
				ActorUserID:       uuid.New(),
			},
		},
		{
			name: "requires target workspace",
			input: AssignInput{
				DeviceID:    uuid.New(),
				ActorUserID: uuid.New(),
			},
		},
		{
			name: "requires actor",
			input: AssignInput{
				DeviceID:          uuid.New(),
				TargetWorkspaceID: uuid.New(),
			},
		},
		{
			name: "requires project when site set",
			input: AssignInput{
				DeviceID:          uuid.New(),
				TargetWorkspaceID: uuid.New(),
				SiteID:            &siteID,
				ActorUserID:       uuid.New(),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := service.Assign(context.Background(), tt.input)
			if apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("expected invalid argument, got %v", err)
			}
		})
	}
}

func TestTopologyRelationValidation(t *testing.T) {
	service := NewService(nil)
	deviceID := uuid.New()

	addCases := []struct {
		name  string
		input AddChildInput
	}{
		{
			name: "requires parent",
			input: AddChildInput{
				ChildDeviceID: uuid.New(),
				ActorUserID:   uuid.New(),
			},
		},
		{
			name: "requires child",
			input: AddChildInput{
				ParentDeviceID: uuid.New(),
				ActorUserID:    uuid.New(),
			},
		},
		{
			name: "rejects self relation",
			input: AddChildInput{
				ParentDeviceID: deviceID,
				ChildDeviceID:  deviceID,
				ActorUserID:    uuid.New(),
			},
		},
		{
			name: "requires actor",
			input: AddChildInput{
				ParentDeviceID: uuid.New(),
				ChildDeviceID:  uuid.New(),
			},
		},
	}

	for _, tt := range addCases {
		t.Run("add "+tt.name, func(t *testing.T) {
			_, err := service.AddChild(context.Background(), tt.input)
			if apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("expected invalid argument, got %v", err)
			}
		})
	}

	removeCases := []struct {
		name  string
		input RemoveChildInput
	}{
		{
			name: "requires parent",
			input: RemoveChildInput{
				ChildDeviceID: uuid.New(),
				ActorUserID:   uuid.New(),
			},
		},
		{
			name: "requires child",
			input: RemoveChildInput{
				ParentDeviceID: uuid.New(),
				ActorUserID:    uuid.New(),
			},
		},
		{
			name: "requires actor",
			input: RemoveChildInput{
				ParentDeviceID: uuid.New(),
				ChildDeviceID:  uuid.New(),
			},
		},
	}

	for _, tt := range removeCases {
		t.Run("remove "+tt.name, func(t *testing.T) {
			_, err := service.RemoveChild(context.Background(), tt.input)
			if apperr.KindOf(err) != apperr.KindInvalidArgument {
				t.Fatalf("expected invalid argument, got %v", err)
			}
		})
	}
}

func TestListChildrenRequiresParentDevice(t *testing.T) {
	service := NewService(nil)

	if _, err := service.ListAdminChildren(context.Background(), uuid.Nil); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected admin children invalid argument, got %v", err)
	}
	if _, err := service.ListVisibleChildren(context.Background(), uuid.Nil); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected visible children invalid argument, got %v", err)
	}
}

func TestDeviceTopologyFieldsFromRows(t *testing.T) {
	now := pgtype.Timestamptz{Time: time.Date(2026, 7, 8, 9, 30, 0, 0, time.UTC), Valid: true}
	deviceID := uuid.New()
	assignmentID := uuid.New()
	workspaceID := uuid.New()
	capabilities := []string{"telemetry", "image_capture"}

	workspaceDevice := fromWorkspaceRow(sqlc.ListDevicesByWorkspaceRow{
		ID:           deviceID,
		SerialNo:     "GW-001",
		Name:         "Gateway",
		Status:       "active",
		CreatedAt:    now,
		UpdatedAt:    now,
		AssignmentID: assignmentID,
		WorkspaceID:  workspaceID,
		AssignedAt:   now,
		TopologyRole: "gateway",
		ChildCount:   3,
	}, capabilities)

	if workspaceDevice.TopologyRole != "gateway" || workspaceDevice.ChildCount != 3 {
		t.Fatalf("expected topology fields to be preserved, got role=%q count=%d", workspaceDevice.TopologyRole, workspaceDevice.ChildCount)
	}
	if workspaceDevice.AssignmentID == nil || *workspaceDevice.AssignmentID != assignmentID {
		t.Fatalf("expected assignment id to be mapped, got %#v", workspaceDevice.AssignmentID)
	}
	if len(workspaceDevice.Capabilities) != 2 {
		t.Fatalf("expected capabilities to be preserved, got %#v", workspaceDevice.Capabilities)
	}

	systemDevice := fromSystemAssetRow(sqlc.ListSystemDeviceAssetsRow{
		ID:           deviceID,
		SerialNo:     "NODE-001",
		Name:         "Node",
		Status:       "active",
		CreatedAt:    now,
		UpdatedAt:    now,
		AssignmentID: &assignmentID,
		WorkspaceID:  &workspaceID,
		AssignedAt:   now,
		TopologyRole: "gateway_node",
		ChildCount:   0,
	}, nil)
	if systemDevice.TopologyRole != "gateway_node" || systemDevice.ChildCount != 0 {
		t.Fatalf("expected system topology fields to be preserved, got role=%q count=%d", systemDevice.TopologyRole, systemDevice.ChildCount)
	}
	if systemDevice.WorkspaceID == nil || *systemDevice.WorkspaceID != workspaceID {
		t.Fatalf("expected system workspace id to be mapped, got %#v", systemDevice.WorkspaceID)
	}
}

func TestChildRowMappingUsesGatewayNodeRole(t *testing.T) {
	now := pgtype.Timestamptz{Time: time.Date(2026, 7, 8, 10, 0, 0, 0, time.UTC), Valid: true}
	relationID := uuid.New()
	parentID := uuid.New()
	childID := uuid.New()
	dataSourceID := uuid.New()
	assignmentID := uuid.New()
	workspaceID := uuid.New()

	child := fromVisibleChildRow(sqlc.ListVisibleDeviceChildrenRow{
		ID:                     relationID,
		ParentDeviceID:         parentID,
		ChildDeviceID:          childID,
		RelationType:           "gateway_node",
		DataSourceID:           dataSourceID,
		ExternalParentDeviceID: 9001,
		ExternalChildDeviceID:  9002,
		Status:                 "active",
		SyncedAt:               now,
		CreatedAt:              now,
		UpdatedAt:              now,
		DeviceID:               childID,
		SerialNo:               "NODE-002",
		Name:                   "Node 2",
		DeviceStatus:           "active",
		DeviceCreatedAt:        now,
		DeviceUpdatedAt:        now,
		AssignmentID:           assignmentID,
		WorkspaceID:            workspaceID,
		AssignedAt:             now,
	}, []string{"telemetry"})

	if child.Device.TopologyRole != "gateway_node" {
		t.Fatalf("expected child device topology role gateway_node, got %q", child.Device.TopologyRole)
	}
	if child.Device.AssignmentID == nil || *child.Device.AssignmentID != assignmentID {
		t.Fatalf("expected child assignment id to be mapped, got %#v", child.Device.AssignmentID)
	}
	if child.Relation.ParentDeviceID != parentID || child.Relation.ChildDeviceID != childID {
		t.Fatalf("unexpected relation mapping: %#v", child.Relation)
	}
}
