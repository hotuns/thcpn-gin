package datasource

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/sources/carbon"
	"thcpn-gin/internal/datasource/sources/lorawanv2"
	"thcpn-gin/internal/datasource/sources/thcpn"

	"github.com/google/uuid"
)

type sourceModule struct {
	Locations      platform.LiveLocationReader
	TemplateTarget func(context.Context, uuid.UUID) (string, *string, error)
	NodeRuntime    platform.NodeRuntimeReader
	Runtime        platform.RuntimeReader
	Config         platform.ConfigManager
	Sampling       platform.SamplingManager
	Reconcile      platform.ConfigReconciler
	SyncAll        func(context.Context, uuid.UUID, uuid.UUID) (any, error)
	Firmware       func(context.Context, platform.SourceFirmwareInput) (int64, error)
}

func (s *Service) registerModules() {
	s.Catalog.Families = map[string]string{platform.SourceFamilyTHCPN: "mysql", platform.SourceFamilyCarbon: "mysql", platform.SourceFamilyLoRaWANV2: "http_api"}
	for _, d := range []platform.AdapterDefinition{thcpn.BindingDefinition(), lorawanv2.BindingDefinition()} {
		s.Catalog.Adapters[d.Code] = d
	}

	s.creators = map[string]deviceCreator{
		platform.CreatedSourceDeviceTHCPNStandard: {Create: s.THCPN.CreateManagedDevice, Retry: s.THCPN.RetryCreatedDevice},
		platform.CreatedSourceDeviceTHCPNGateway:  {Create: s.THCPN.CreateManagedDevice, Retry: s.THCPN.RetryCreatedDevice},
		platform.CreatedSourceDeviceTHCPNNode:     {Create: s.THCPN.CreateManagedDevice, Retry: s.THCPN.RetryCreatedDevice},
		platform.CreatedSourceDeviceCarbon:        {Create: s.Carbon.CreateManagedDevice, Retry: s.Carbon.RetryCreatedDevice},
	}

	s.modules = map[string]sourceModule{
		platform.SourceFamilyTHCPN: {Locations: s.THCPN, TemplateTarget: s.THCPN.SensorTemplateTarget, Runtime: s.THCPN, Config: s.THCPN, Sampling: s.THCPN, Reconcile: s.THCPN, SyncAll: func(ctx context.Context, id, actor uuid.UUID) (any, error) {
			return s.THCPN.SyncAllTHCPNDevices(ctx, thcpn.SyncAllTHCPNDevicesInput{DataSourceID: id, ActorUserID: actor})
		}, Firmware: s.THCPN.RegisterFirmware},
		platform.SourceFamilyCarbon: {Config: s.Carbon, Sampling: s.Carbon, Reconcile: s.Carbon, SyncAll: func(ctx context.Context, id, actor uuid.UUID) (any, error) {
			return s.Carbon.SyncAllCarbonDevices(ctx, carbon.SyncAllCarbonDevicesInput{DataSourceID: id, ActorUserID: actor})
		}, Firmware: s.Carbon.RegisterFirmware},
		platform.SourceFamilyLoRaWANV2: {NodeRuntime: s.LoRaWAN, Firmware: s.LoRaWAN.RegisterFirmware, Reconcile: s.LoRaWAN, SyncAll: func(ctx context.Context, id, actor uuid.UUID) (any, error) {
			return s.LoRaWAN.SyncAllLoRaWANV2Gateways(ctx, lorawanv2.SyncAllLoRaWANV2GatewaysInput{DataSourceID: id, ActorUserID: actor})
		}},
	}
}
func (s *Service) moduleForDevice(ctx context.Context, id uuid.UUID) (sourceModule, error) {
	if s.DB == nil {
		return sourceModule{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	var family string
	err := s.DB.QueryRow(ctx, `SELECT COALESCE(source.source_family,'') FROM device_source_refs ref JOIN data_sources source ON source.id=ref.data_source_id WHERE ref.device_id=$1 AND ref.status='active' AND source.status='active'`, id).Scan(&family)
	if err != nil {
		return sourceModule{}, platform.MapNotFoundOrInternal(err, "active device source not found")
	}
	m, ok := s.modules[family]
	if !ok {
		return sourceModule{}, apperr.New(apperr.KindInvalidArgument, "device source is not supported")
	}
	return m, nil
}
func unsupportedCapability() error {
	return apperr.New(apperr.KindInvalidArgument, "device source does not support this operation")
}

type deviceCreator struct {
	Create func(context.Context, platform.CreateSourceDeviceInput) (platform.CreatedSourceDevice, error)
	Retry  func(context.Context, uuid.UUID, string, int64, uuid.UUID) (platform.CreatedSourceDevice, error)
}

var creationFamilies = map[string]string{
	platform.CreatedSourceDeviceTHCPNStandard: platform.SourceFamilyTHCPN,
	platform.CreatedSourceDeviceTHCPNGateway:  platform.SourceFamilyTHCPN,
	platform.CreatedSourceDeviceTHCPNNode:     platform.SourceFamilyTHCPN,
	platform.CreatedSourceDeviceCarbon:        platform.SourceFamilyCarbon,
}
