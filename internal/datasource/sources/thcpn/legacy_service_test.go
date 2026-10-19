package thcpn

import (
	"context"
	"encoding/json"
	"testing"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"

	"github.com/google/uuid"
)

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
func TestValidateTHCPNGatewaySyncInputDoesNotRequireAssignment(t *testing.T) {
	_, err := validateTHCPNGatewaySyncInput(SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
		ActorUserID:       uuid.New(),
	})
	if err != nil {
		t.Fatalf("expected system asset sync input to be valid, got %v", err)
	}
}
func TestNormalizeTHCPNConfigJSONShapes(t *testing.T) {
	if _, err := platform.NormalizeConfigArrayJSON(json.RawMessage(`{"bad":true}`), "data_json"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected object data_json to fail, got %v", err)
	}
	if _, err := platform.NormalizeConfigArrayJSON(json.RawMessage(`[{"key":"temp"}]`), "data_json"); err != nil {
		t.Fatalf("expected array data_json to pass, got %v", err)
	}
	if _, err := platform.NormalizeConfigObjectJSON(json.RawMessage(`[{"bad":true}]`), "control_json"); apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected array control_json to fail, got %v", err)
	}
	if _, err := platform.NormalizeConfigObjectJSON(json.RawMessage(`{"relay":true}`), "control_json"); err != nil {
		t.Fatalf("expected object control_json to pass, got %v", err)
	}
}
func TestCapabilitiesForSyncedTHCPNStreams(t *testing.T) {
	capabilities := capabilitiesForSyncedTHCPNStreams([]platform.SyncedDataStream{
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
	service := newTestService(nil)

	_, err := service.SyncTHCPNGateway(context.Background(), SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
	})
	if apperr.KindOf(err) != apperr.KindInvalidArgument {
		t.Fatalf("expected invalid argument before database access, got %v", err)
	}
}
func TestSyncTHCPNGatewayRequiresDatabaseForValidInput(t *testing.T) {
	service := newTestService(nil)

	_, err := service.SyncTHCPNGateway(context.Background(), SyncTHCPNGatewayInput{
		ExternalGatewayID: 9001,
		ActorUserID:       uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error for missing database, got %v", err)
	}
}
func TestPlatformTHCPNDeviceType(t *testing.T) {
	tests := []struct {
		value string
		want  string
	}{
		{value: "", want: "standalone"},
		{value: "0", want: "standalone"},
		{value: "9", want: "standalone"},
		{value: "10", want: "gateway"},
		{value: "11", want: "gateway_node"},
		{value: "19", want: "gateway_node"},
		{value: " gateway ", want: "standalone"},
	}
	for _, tt := range tests {
		if got := platformTHCPNDeviceType(tt.value); got != tt.want {
			t.Fatalf("expected external type %q to map to %q, got %q", tt.value, tt.want, got)
		}
	}
}
func TestSyncedTHCPNDeviceTypeUsesGatewayTopology(t *testing.T) {
	topology := []thcpnGatewayTopology{
		{GatewayID: 10, NodeIDs: []int64{11, 12}},
	}
	gateways, nodes := indexTHCPNTopology(topology)
	tests := []struct {
		id           int64
		externalType string
		want         string
	}{
		{id: 10, want: "gateway"},
		{id: 11, externalType: "10", want: "gateway_node"},
		{id: 20, externalType: "10", want: "gateway"},
		{id: 21, externalType: "1", want: "standalone"},
	}
	for _, tt := range tests {
		got := syncedTHCPNDeviceType(thcpnExternalDeviceIndex{ID: tt.id, DeviceType: tt.externalType}, gateways, nodes)
		if got != tt.want {
			t.Fatalf("device %d: expected %q, got %q", tt.id, tt.want, got)
		}
	}
}
func TestSyncAllTHCPNDevicesRequiresDatabaseForValidInput(t *testing.T) {
	service := newTestService(nil)
	_, err := service.SyncAllTHCPNDevices(context.Background(), SyncAllTHCPNDevicesInput{
		DataSourceID: uuid.New(),
		ActorUserID:  uuid.New(),
	})
	if apperr.KindOf(err) != apperr.KindInternal {
		t.Fatalf("expected internal error for missing database, got %v", err)
	}
}
