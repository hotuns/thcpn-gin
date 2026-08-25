package datasource

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"path"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const (
	defaultTHCPNProductID            = "thcpn_standard_station"
	defaultTHCPNMediaPublicURLPrefix = "https://iot-datas.oss-cn-beijing.aliyuncs.com"
)

type SyncTHCPNStandardStationInput struct {
	DataSourceID     uuid.UUID
	ExternalDeviceID int64
	ActorUserID      uuid.UUID
}

type SyncAllTHCPNDevicesInput struct {
	DataSourceID uuid.UUID
	ActorUserID  uuid.UUID
}

type SyncTHCPNCameraInput struct {
	DataSourceID     uuid.UUID
	ExternalCameraID int64
	ActorUserID      uuid.UUID
}

type SyncTHCPNGatewayInput struct {
	DataSourceID      uuid.UUID
	ExternalGatewayID int64
	ActorUserID       uuid.UUID
}

type THCPNStandardStationSyncResult struct {
	Device         SyncedDevice                `json:"device"`
	SourceRef      DeviceSourceRef             `json:"source_ref"`
	ConfigSnapshot DeviceConfigSnapshot        `json:"config_snapshot"`
	DataStreams    []SyncedDataStream          `json:"data_streams"`
	Bindings       []DataStreamBinding         `json:"bindings"`
	ExternalDevice THCPNExternalDeviceMetadata `json:"external_device"`
}

type THCPNGatewaySyncResult struct {
	Gateway          THCPNStandardStationSyncResult   `json:"gateway"`
	Nodes            []THCPNStandardStationSyncResult `json:"nodes"`
	Relations        []DeviceRelation                 `json:"relations"`
	RemovedRelations []DeviceRelation                 `json:"removed_relations,omitempty"`
	Warnings         []QueryWarning                   `json:"warnings,omitempty"`
}

type THCPNDeviceSyncFailure struct {
	ExternalDeviceID int64  `json:"external_device_id"`
	ResourceType     string `json:"resource_type,omitempty"`
	Error            string `json:"error"`
}

type THCPNAllDevicesSyncResult struct {
	DataSourceID   uuid.UUID                `json:"data_source_id"`
	Total          int                      `json:"total"`
	Synced         int                      `json:"synced"`
	Created        int                      `json:"created"`
	Updated        int                      `json:"updated"`
	Unconfigured   int                      `json:"unconfigured"`
	Failed         int                      `json:"failed"`
	Relations      int                      `json:"relations"`
	TopologyFailed int                      `json:"topology_failed"`
	CamerasTotal   int                      `json:"cameras_total"`
	CamerasSynced  int                      `json:"cameras_synced"`
	CamerasFailed  int                      `json:"cameras_failed"`
	Failures       []THCPNDeviceSyncFailure `json:"failures,omitempty"`
}

type THCPNExternalCamera struct {
	ID           int64      `json:"id"`
	DeviceSerial string     `json:"device_serial"`
	Name         string     `json:"name"`
	Channel      int32      `json:"channel"`
	Poster       string     `json:"poster"`
	CreatedAt    *time.Time `json:"created_at,omitempty"`
	UpdatedAt    *time.Time `json:"updated_at,omitempty"`
}

type THCPNCameraSyncResult struct {
	Device    SyncedDevice        `json:"device"`
	SourceRef DeviceSourceRef     `json:"source_ref"`
	Camera    THCPNExternalCamera `json:"external_camera"`
}

type thcpnExternalDeviceIndex struct {
	ID         int64
	DeviceType string
}

type thcpnGatewayTopology struct {
	GatewayID int64
	NodeIDs   []int64
}

type THCPNDeviceConfig struct {
	ID          int64           `json:"id"`
	DeviceID    int64           `json:"device_id"`
	Version     *string         `json:"version,omitempty"`
	UUID        *string         `json:"uuid,omitempty"`
	IsMG        bool            `json:"is_mg"`
	DataJSON    json.RawMessage `json:"data_json"`
	ImageJSON   json.RawMessage `json:"image_json"`
	ControlJSON json.RawMessage `json:"control_json"`
	CreatedAt   *time.Time      `json:"created_at,omitempty"`
	UpdatedAt   *time.Time      `json:"updated_at,omitempty"`
}

type THCPNDeviceConfigDetailResponse struct {
	DeviceID         uuid.UUID             `json:"device_id"`
	DataSourceID     uuid.UUID             `json:"data_source_id"`
	ExternalDeviceID int64                 `json:"external_device_id"`
	LatestConfig     THCPNDeviceConfig     `json:"latest_config"`
	LatestSnapshot   *DeviceConfigSnapshot `json:"latest_snapshot,omitempty"`
}

type UpdateTHCPNDeviceConfigInput struct {
	DeviceID         uuid.UUID
	DataJSON         json.RawMessage
	ImageJSON        json.RawMessage
	ControlJSON      json.RawMessage
	ActorUserID      uuid.UUID
	ExpectedConfigID int64
}

type UpdateTHCPNDeviceConfigResponse struct {
	DeviceID            uuid.UUID            `json:"device_id"`
	DataSourceID        uuid.UUID            `json:"data_source_id"`
	ExternalDeviceID    int64                `json:"external_device_id"`
	Config              THCPNDeviceConfig    `json:"config"`
	ConfigSnapshot      DeviceConfigSnapshot `json:"config_snapshot"`
	DataStreams         []SyncedDataStream   `json:"data_streams"`
	Bindings            []DataStreamBinding  `json:"bindings"`
	DisabledDataStreams []SyncedDataStream   `json:"disabled_data_streams,omitempty"`
	DisabledBindings    []DataStreamBinding  `json:"disabled_bindings,omitempty"`
	Warnings            []QueryWarning       `json:"warnings,omitempty"`
	Audit               THCPNConfigAudit     `json:"-"`
}

type THCPNConfigAudit struct {
	PreviousConfigID int64
	ChangedSections  []string
	SensorCount      int
	MetricCount      int
	ImageCount       int
}

type SyncedDevice struct {
	ID           uuid.UUID  `json:"id"`
	AssignmentID *uuid.UUID `json:"assignment_id,omitempty"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	ProjectID    *uuid.UUID `json:"project_id,omitempty"`
	SiteID       *uuid.UUID `json:"site_id,omitempty"`
	ProductID    *string    `json:"product_id,omitempty"`
	SerialNo     string     `json:"serial_no"`
	Name         string     `json:"name"`
	Status       string     `json:"status"`
	DeviceType   string     `json:"device_type"`
	AssignedBy   *uuid.UUID `json:"assigned_by,omitempty"`
	AssignedAt   *time.Time `json:"assigned_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type DeviceRelation struct {
	ID                     uuid.UUID `json:"id"`
	ParentDeviceID         uuid.UUID `json:"parent_device_id"`
	ChildDeviceID          uuid.UUID `json:"child_device_id"`
	RelationType           string    `json:"relation_type"`
	DataSourceID           uuid.UUID `json:"data_source_id"`
	ExternalParentDeviceID int64     `json:"external_parent_device_id"`
	ExternalChildDeviceID  int64     `json:"external_child_device_id"`
	Status                 string    `json:"status"`
	SyncedAt               time.Time `json:"synced_at"`
	CreatedAt              time.Time `json:"created_at"`
	UpdatedAt              time.Time `json:"updated_at"`
}

type SyncedDataStream struct {
	ID       uuid.UUID `json:"id"`
	DeviceID uuid.UUID `json:"device_id"`
	Code     string    `json:"code"`
	Name     string    `json:"name"`
	Type     string    `json:"type"`
	Unit     *string   `json:"unit,omitempty"`
	Status   string    `json:"status"`
}

type DeviceSourceRef struct {
	ID               uuid.UUID `json:"id"`
	DeviceID         uuid.UUID `json:"device_id"`
	DataSourceID     uuid.UUID `json:"data_source_id"`
	AdapterCode      string    `json:"adapter_code"`
	ExternalDeviceID int64     `json:"external_device_id"`
	Status           string    `json:"status"`
	SyncedAt         time.Time `json:"synced_at"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type DeviceConfigSnapshot struct {
	ID               uuid.UUID       `json:"id"`
	DeviceID         uuid.UUID       `json:"device_id"`
	DataSourceID     uuid.UUID       `json:"data_source_id"`
	AdapterCode      string          `json:"adapter_code"`
	ExternalDeviceID int64           `json:"external_device_id"`
	ExternalConfigID int64           `json:"external_config_id"`
	Version          *string         `json:"version,omitempty"`
	DataJSON         json.RawMessage `json:"data_json"`
	ImageJSON        json.RawMessage `json:"image_json"`
	ControlJSON      json.RawMessage `json:"control_json"`
	SourceCreatedAt  *time.Time      `json:"source_created_at,omitempty"`
	SourceUpdatedAt  *time.Time      `json:"source_updated_at,omitempty"`
	SyncedAt         time.Time       `json:"synced_at"`
	CreatedAt        time.Time       `json:"created_at"`
}

type THCPNExternalDeviceMetadata struct {
	ID                   int64      `json:"id"`
	Name                 string     `json:"name"`
	ICCID                *string    `json:"iccid,omitempty"`
	Version              *string    `json:"version,omitempty"`
	Status               *string    `json:"status,omitempty"`
	DeviceType           *string    `json:"device_type,omitempty"`
	Active               *int64     `json:"active,omitempty"`
	SN                   *string    `json:"sn,omitempty"`
	UUID                 *string    `json:"uuid,omitempty"`
	CurrentDeviceVersion *string    `json:"current_device_version,omitempty"`
	Latitude             *float64   `json:"lat,omitempty"`
	Longitude            *float64   `json:"lon,omitempty"`
	AltitudeM            *float64   `json:"alt,omitempty"`
	AvatarURLs           []string   `json:"avatar_urls,omitempty"`
	CreatedAt            *time.Time `json:"created_at,omitempty"`
	UpdatedAt            *time.Time `json:"updated_at,omitempty"`
}

type thcpnExternalDevice struct {
	THCPNExternalDeviceMetadata
}

type thcpnExternalConfig struct {
	ID        int64
	DeviceID  int64
	Data      json.RawMessage
	Image     json.RawMessage
	Control   json.RawMessage
	Version   *string
	UUID      *string
	IsMG      bool
	CreatedAt *time.Time
	UpdatedAt *time.Time
}

type thcpnConfigQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type thcpnStreamSpec struct {
	Code          string
	Name          string
	Type          string
	Unit          string
	JSONKey       string
	PayloadType   string
	AdapterConfig json.RawMessage
}

type thcpnDeviceSyncInput struct {
	TargetWorkspaceID uuid.UUID
	ProjectID         *uuid.UUID
	SiteID            *uuid.UUID
	ExternalDeviceID  int64
	DeviceType        string
	ProductID         string
	Name              string
	ActorUserID       uuid.UUID
}

func (s *Service) SyncTHCPNStandardStation(ctx context.Context, input SyncTHCPNStandardStationInput) (THCPNStandardStationSyncResult, error) {
	if s.db == nil {
		return THCPNStandardStationSyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	deviceInput := thcpnDeviceSyncInput{
		ExternalDeviceID: input.ExternalDeviceID,
		DeviceType:       "standalone",
		ActorUserID:      input.ActorUserID,
	}
	if err := validateTHCPNDeviceSyncInput(deviceInput); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	runtime := NewRuntime(nil)
	deviceDB, err := runtime.openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	defer deviceDB.Close()

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn sync transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.queries.WithTx(tx)

	result, err := s.syncTHCPNDevice(ctx, q, source, deviceDB, deviceInput)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn sync transaction", err)
	}
	committed = true

	return result, nil
}

func (s *Service) SyncTHCPNCamera(ctx context.Context, input SyncTHCPNCameraInput) (THCPNCameraSyncResult, error) {
	if input.ActorUserID == uuid.Nil {
		return THCPNCameraSyncResult{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.ExternalCameraID <= 0 {
		return THCPNCameraSyncResult{}, apperr.New(apperr.KindInvalidArgument, "external_camera_id is required")
	}
	if s.db == nil {
		return THCPNCameraSyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNCameraSyncResult{}, err
	}
	deviceDB, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNCameraSyncResult{}, err
	}
	defer deviceDB.Close()

	camera, err := readTHCPNExternalCamera(ctx, deviceDB, input.ExternalCameraID)
	if err != nil {
		return THCPNCameraSyncResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNCameraSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn camera sync transaction", err)
	}
	defer tx.Rollback(ctx)
	result, err := s.syncTHCPNCamera(ctx, s.queries.WithTx(tx), source.ID, camera)
	if err != nil {
		return THCPNCameraSyncResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNCameraSyncResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn camera sync transaction", err)
	}
	return result, nil
}

func (s *Service) syncTHCPNCamera(
	ctx context.Context,
	q *sqlc.Queries,
	dataSourceID uuid.UUID,
	camera THCPNExternalCamera,
) (THCPNCameraSyncResult, error) {
	if strings.TrimSpace(camera.DeviceSerial) == "" || camera.Channel <= 0 {
		return THCPNCameraSyncResult{}, apperr.New(apperr.KindDataSource, "thcpn camera serial and channel are required")
	}
	name := strings.TrimSpace(camera.Name)
	if name == "" {
		name = strings.TrimSpace(camera.DeviceSerial)
	}

	var device sqlc.Device
	ref, err := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
		DataSourceID: dataSourceID, AdapterCode: AdapterTHCPNCamera, ExternalDeviceID: camera.ID,
	})
	if err == nil {
		current, err := q.GetDevice(ctx, ref.DeviceID)
		if err != nil {
			return THCPNCameraSyncResult{}, mapNotFoundOrInternal(err, "mapped camera device not found")
		}
		device, err = q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{
			ID: current.ID, ProductID: optionalString("thcpn_camera"), Name: name, Status: "active",
		})
		if err != nil {
			return THCPNCameraSyncResult{}, mapWriteError(err, "update synced camera")
		}
		if device.DeviceType != "camera" {
			device, err = q.UpdateDeviceType(ctx, sqlc.UpdateDeviceTypeParams{ID: device.ID, DeviceType: "camera"})
			if err != nil {
				return THCPNCameraSyncResult{}, mapWriteError(err, "update synced camera type")
			}
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		device, err = q.CreateCameraDevice(ctx, sqlc.CreateCameraDeviceParams{
			ProductID: optionalString("thcpn_camera"), Name: name,
		})
		if err != nil {
			return THCPNCameraSyncResult{}, mapWriteError(err, "create synced camera")
		}
	} else {
		return THCPNCameraSyncResult{}, apperr.Wrap(apperr.KindInternal, "lookup camera source ref", err)
	}

	if _, err := q.UpsertCameraBinding(ctx, sqlc.UpsertCameraBindingParams{
		DeviceID: device.ID, DeviceSerial: camera.DeviceSerial, ChannelNo: camera.Channel,
		DefaultQuality: "hd", IsEncrypted: false, Status: "active",
	}); err != nil {
		return THCPNCameraSyncResult{}, mapWriteError(err, "upsert synced camera binding")
	}
	if err := addDeviceCapabilityIfMissing(ctx, q, device.ID, "video_stream"); err != nil {
		return THCPNCameraSyncResult{}, err
	}
	sourceRef, err := q.UpsertDeviceSourceRef(ctx, sqlc.UpsertDeviceSourceRefParams{
		DeviceID: device.ID, DataSourceID: dataSourceID, AdapterCode: AdapterTHCPNCamera, ExternalDeviceID: camera.ID,
	})
	if err != nil {
		return THCPNCameraSyncResult{}, mapWriteError(err, "upsert camera source ref")
	}
	return THCPNCameraSyncResult{
		Device: syncedDeviceFromSQL(device, nil), SourceRef: deviceSourceRefFromSQL(sourceRef), Camera: camera,
	}, nil
}

// SyncAllTHCPNDevices imports every non-deleted row from the source devices
// table. Each device is committed independently so one incomplete external
// configuration does not roll back the rest of the import.
func (s *Service) SyncAllTHCPNDevices(ctx context.Context, input SyncAllTHCPNDevicesInput) (THCPNAllDevicesSyncResult, error) {
	if input.ActorUserID == uuid.Nil {
		return THCPNAllDevicesSyncResult{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if s.db == nil {
		return THCPNAllDevicesSyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	deviceDB, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	defer deviceDB.Close()

	externalDevices, err := readAllTHCPNExternalDevices(ctx, deviceDB)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	topology, err := readAllTHCPNGatewayTopology(ctx, deviceDB)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	cameras, err := readAllTHCPNExternalCameras(ctx, deviceDB)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	gatewayIDs, nodeIDs := indexTHCPNTopology(topology)
	result := THCPNAllDevicesSyncResult{
		DataSourceID: input.DataSourceID,
		Total:        len(externalDevices),
		CamerasTotal: len(cameras),
		Failures:     make([]THCPNDeviceSyncFailure, 0),
	}
	for _, externalDevice := range externalDevices {
		externalDeviceID := externalDevice.ID
		if err := ctx.Err(); err != nil {
			return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "thcpn full sync canceled", err)
		}
		_, lookupErr := s.queries.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
			DataSourceID: input.DataSourceID, AdapterCode: AdapterTHCPNLegacy, ExternalDeviceID: externalDeviceID,
		})
		existed := lookupErr == nil
		if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
			result.Failed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{ExternalDeviceID: externalDeviceID, Error: apperr.MessageOf(lookupErr)})
			continue
		}
		// A row in devices is still a valid platform asset when the external
		// database has not created device_config for it yet. Import its metadata
		// and source reference, then expose it as unconfigured instead of losing
		// it from the full synchronization.
		if _, configErr := readLatestTHCPNDeviceConfig(ctx, deviceDB, externalDeviceID); apperr.KindOf(configErr) == apperr.KindNotFound {
			tx, txErr := s.db.BeginTx(ctx, pgx.TxOptions{})
			if txErr != nil {
				return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn metadata sync transaction", txErr)
			}
			q := s.queries.WithTx(tx)
			_, _, metadataErr := s.syncTHCPNDeviceMetadata(ctx, q, source, deviceDB, externalDeviceID, syncedTHCPNDeviceType(externalDevice, gatewayIDs, nodeIDs), input.ActorUserID)
			if metadataErr == nil {
				metadataErr = tx.Commit(ctx)
			} else {
				_ = tx.Rollback(ctx)
			}
			if metadataErr != nil {
				result.Failed++
				result.Failures = append(result.Failures, THCPNDeviceSyncFailure{ExternalDeviceID: externalDeviceID, Error: apperr.MessageOf(metadataErr)})
				continue
			}
			result.Synced++
			result.Unconfigured++
			if existed {
				result.Updated++
			} else {
				result.Created++
			}
			continue
		}

		tx, txErr := s.db.BeginTx(ctx, pgx.TxOptions{})
		if txErr != nil {
			return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn full sync transaction", txErr)
		}
		q := s.queries.WithTx(tx)
		_, syncErr := s.syncTHCPNDevice(ctx, q, source, deviceDB, thcpnDeviceSyncInput{
			ExternalDeviceID: externalDeviceID,
			DeviceType:       syncedTHCPNDeviceType(externalDevice, gatewayIDs, nodeIDs),
			ActorUserID:      input.ActorUserID,
		})
		if syncErr == nil {
			syncErr = tx.Commit(ctx)
		} else {
			_ = tx.Rollback(ctx)
		}
		if syncErr != nil {
			result.Failed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{ExternalDeviceID: externalDeviceID, Error: apperr.MessageOf(syncErr)})
			continue
		}
		result.Synced++
		if existed {
			result.Updated++
		} else {
			result.Created++
		}
	}
	relationCount, topologyFailures := s.syncTHCPNTopology(ctx, source.ID, topology)
	result.Relations = relationCount
	result.TopologyFailed = len(topologyFailures)
	result.Failures = append(result.Failures, topologyFailures...)
	for _, camera := range cameras {
		tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			result.CamerasFailed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{
				ExternalDeviceID: camera.ID, ResourceType: "camera", Error: apperr.MessageOf(err),
			})
			continue
		}
		if _, err := s.syncTHCPNCamera(ctx, s.queries.WithTx(tx), source.ID, camera); err != nil {
			_ = tx.Rollback(ctx)
			result.CamerasFailed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{
				ExternalDeviceID: camera.ID, ResourceType: "camera", Error: apperr.MessageOf(err),
			})
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			result.CamerasFailed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{
				ExternalDeviceID: camera.ID, ResourceType: "camera", Error: apperr.MessageOf(err),
			})
			continue
		}
		result.CamerasSynced++
	}
	return result, nil
}

func (s *Service) syncTHCPNDeviceMetadata(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, deviceDB *sql.DB, externalDeviceID int64, deviceType string, actorUserID uuid.UUID) (sqlc.Device, bool, error) {
	externalDevice, err := readTHCPNExternalDevice(ctx, deviceDB, externalDeviceID)
	if err != nil {
		return sqlc.Device{}, false, err
	}
	deviceRow, _, created, err := s.upsertTHCPNPlatformDevice(ctx, q, source, thcpnDeviceSyncInput{
		ExternalDeviceID: externalDeviceID,
		DeviceType:       deviceType,
		ActorUserID:      actorUserID,
	}, externalDevice)
	if err != nil {
		return sqlc.Device{}, false, err
	}
	if _, err := q.UpsertDeviceSourceRef(ctx, sqlc.UpsertDeviceSourceRefParams{
		DeviceID:         deviceRow.ID,
		DataSourceID:     source.ID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: externalDeviceID,
	}); err != nil {
		return sqlc.Device{}, false, mapWriteError(err, "upsert device source ref")
	}
	return deviceRow, created, nil
}

func (s *Service) SyncTHCPNGateway(ctx context.Context, input SyncTHCPNGatewayInput) (THCPNGatewaySyncResult, error) {
	gatewayInput, err := validateTHCPNGatewaySyncInput(input)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	if s.db == nil {
		return THCPNGatewaySyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	runtime := NewRuntime(nil)
	deviceDB, err := runtime.openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	defer deviceDB.Close()

	gateNodes, err := readTHCPNGateNodes(ctx, deviceDB, input.ExternalGatewayID)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNGatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn gateway sync transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.queries.WithTx(tx)

	gateway, err := s.syncTHCPNDevice(ctx, q, source, deviceDB, gatewayInput)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	nodes := make([]THCPNStandardStationSyncResult, 0, len(gateNodes))
	relations := make([]DeviceRelation, 0, len(gateNodes))
	activeChildIDs := make([]int64, 0, len(gateNodes))
	for _, nodeID := range gateNodes {
		nodeInput := thcpnDeviceSyncInput{
			ExternalDeviceID: nodeID,
			DeviceType:       "gateway_node",
			ActorUserID:      input.ActorUserID,
		}
		node, err := s.syncTHCPNDevice(ctx, q, source, deviceDB, nodeInput)
		if err != nil {
			return THCPNGatewaySyncResult{}, err
		}
		relation, err := q.UpsertDeviceRelation(ctx, sqlc.UpsertDeviceRelationParams{
			ParentDeviceID:         gateway.Device.ID,
			ChildDeviceID:          node.Device.ID,
			RelationType:           "gateway_node",
			DataSourceID:           source.ID,
			ExternalParentDeviceID: input.ExternalGatewayID,
			ExternalChildDeviceID:  nodeID,
		})
		if err != nil {
			return THCPNGatewaySyncResult{}, mapWriteError(err, "upsert device relation")
		}
		activeChildIDs = append(activeChildIDs, nodeID)
		nodes = append(nodes, node)
		relations = append(relations, deviceRelationFromUpsertRow(relation))
	}
	removed, err := q.MarkMissingDeviceRelationsRemoved(ctx, sqlc.MarkMissingDeviceRelationsRemovedParams{
		DataSourceID:           source.ID,
		ExternalParentDeviceID: input.ExternalGatewayID,
		ActiveChildIds:         activeChildIDs,
	})
	if err != nil {
		return THCPNGatewaySyncResult{}, mapWriteError(err, "mark missing device relations removed")
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNGatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn gateway sync transaction", err)
	}
	committed = true

	removedRelations := make([]DeviceRelation, 0, len(removed))
	for _, relation := range removed {
		removedRelations = append(removedRelations, deviceRelationFromSQL(relation))
	}
	result := THCPNGatewaySyncResult{
		Gateway:          gateway,
		Nodes:            nodes,
		Relations:        relations,
		RemovedRelations: removedRelations,
	}
	if len(nodes) == 0 {
		result.Warnings = append(result.Warnings, QueryWarning{
			Code:    "thcpn_gateway_without_nodes",
			Message: "未在 gate_node 中发现该网关的 active 节点",
		})
	}
	return result, nil
}

func (s *Service) GetTHCPNDeviceConfig(ctx context.Context, deviceID uuid.UUID) (THCPNDeviceConfigDetailResponse, error) {
	if s.db == nil {
		return THCPNDeviceConfigDetailResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	if deviceID == uuid.Nil {
		return THCPNDeviceConfigDetailResponse{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	ref, err := s.queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, mapNotFoundOrInternal(err, "thcpn device source ref not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, err
	}

	runtime := NewRuntime(nil)
	deviceDB, err := runtime.openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, err
	}
	defer deviceDB.Close()

	latestConfig, err := readLatestTHCPNDeviceConfig(ctx, deviceDB, ref.ExternalDeviceID)
	if err != nil {
		return THCPNDeviceConfigDetailResponse{}, err
	}
	var latestSnapshot *DeviceConfigSnapshot
	if snapshot, err := s.queries.GetLatestDeviceConfigSnapshotByDevice(ctx, deviceID); err == nil {
		converted := deviceConfigSnapshotFromSQL(snapshot)
		latestSnapshot = &converted
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return THCPNDeviceConfigDetailResponse{}, apperr.Wrap(apperr.KindInternal, "get latest device config snapshot", err)
	}

	return THCPNDeviceConfigDetailResponse{
		DeviceID:         deviceID,
		DataSourceID:     ref.DataSourceID,
		ExternalDeviceID: ref.ExternalDeviceID,
		LatestConfig:     thcpnDeviceConfigFromExternal(latestConfig),
		LatestSnapshot:   latestSnapshot,
	}, nil
}

func (s *Service) UpdateTHCPNDeviceConfig(ctx context.Context, input UpdateTHCPNDeviceConfigInput) (UpdateTHCPNDeviceConfigResponse, error) {
	if s.db == nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	if input.DeviceID == uuid.Nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.ExpectedConfigID <= 0 {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}
	dataJSON, err := normalizeTHCPNConfigArrayJSON(input.DataJSON, "data_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	imageJSON, err := normalizeTHCPNConfigArrayJSON(input.ImageJSON, "image_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	controlJSON, err := normalizeTHCPNConfigObjectJSON(input.ControlJSON, "control_json")
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}

	ref, err := s.queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, input.DeviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, mapNotFoundOrInternal(err, "thcpn device source ref not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}

	runtime := NewRuntime(nil)
	deviceDB, err := runtime.openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	defer deviceDB.Close()

	mysqlTx, err := deviceDB.BeginTx(ctx, nil)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindDataSource, "begin thcpn config transaction", err)
	}
	mysqlCommitted := false
	defer func() {
		if !mysqlCommitted {
			_ = mysqlTx.Rollback()
		}
	}()
	previous, err := readLatestTHCPNDeviceConfigForUpdate(ctx, mysqlTx, ref.ExternalDeviceID)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	if previous.ID != input.ExpectedConfigID {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}
	auditSummary := summarizeTHCPNConfigChange(previous, dataJSON, imageJSON, controlJSON)
	inserted, err := insertTHCPNDeviceConfig(ctx, mysqlTx, previous, dataJSON, imageJSON, controlJSON)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	if err := mysqlTx.Commit(); err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindDataSource, "commit thcpn config transaction", err)
	}
	mysqlCommitted = true

	pgTx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindInternal, "begin thcpn config apply transaction", err)
	}
	pgCommitted := false
	defer func() {
		if !pgCommitted {
			_ = pgTx.Rollback(ctx)
		}
	}()
	q := s.queries.WithTx(pgTx)
	applied, err := applyTHCPNConfigToPlatform(ctx, q, source.ID, input.DeviceID, ref.ExternalDeviceID, inserted, input.ActorUserID, true)
	if err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, err
	}
	for _, capability := range capabilitiesForSyncedTHCPNStreams(applied.Streams) {
		if err := addDeviceCapabilityIfMissing(ctx, q, input.DeviceID, capability); err != nil {
			return UpdateTHCPNDeviceConfigResponse{}, err
		}
	}
	if err := pgTx.Commit(ctx); err != nil {
		return UpdateTHCPNDeviceConfigResponse{}, apperr.Wrap(apperr.KindInternal, "commit thcpn config apply transaction", err)
	}
	pgCommitted = true

	return UpdateTHCPNDeviceConfigResponse{
		DeviceID:            input.DeviceID,
		DataSourceID:        source.ID,
		ExternalDeviceID:    ref.ExternalDeviceID,
		Config:              thcpnDeviceConfigFromExternal(inserted),
		ConfigSnapshot:      applied.Snapshot,
		DataStreams:         applied.Streams,
		Bindings:            applied.Bindings,
		DisabledDataStreams: applied.DisabledStreams,
		DisabledBindings:    applied.DisabledBindings,
		Audit:               auditSummary,
	}, nil
}

func summarizeTHCPNConfigChange(previous thcpnExternalConfig, dataJSON, imageJSON, controlJSON json.RawMessage) THCPNConfigAudit {
	result := THCPNConfigAudit{PreviousConfigID: previous.ID}
	if !jsonSemanticallyEqual(previous.Data, dataJSON) {
		result.ChangedSections = append(result.ChangedSections, "data_json")
	}
	if !jsonSemanticallyEqual(previous.Image, imageJSON) {
		result.ChangedSections = append(result.ChangedSections, "image_json")
	}
	if !jsonSemanticallyEqual(previous.Control, controlJSON) {
		result.ChangedSections = append(result.ChangedSections, "control_json")
	}
	var sensors []map[string]any
	if json.Unmarshal(dataJSON, &sensors) == nil {
		result.SensorCount = len(sensors)
		for _, sensor := range sensors {
			params, _ := sensor["params"].(map[string]any)
			contents, _ := params["contents"].([]any)
			result.MetricCount += len(contents)
		}
	}
	var images []any
	if json.Unmarshal(imageJSON, &images) == nil {
		result.ImageCount = len(images)
	}
	return result
}

func jsonSemanticallyEqual(left, right json.RawMessage) bool {
	var leftValue, rightValue any
	if json.Unmarshal(left, &leftValue) != nil || json.Unmarshal(right, &rightValue) != nil {
		return false
	}
	return reflect.DeepEqual(leftValue, rightValue)
}

func (s *Service) loadTHCPNSyncDataSource(ctx context.Context, dataSourceID uuid.UUID) (sqlc.DataSource, error) {
	if dataSourceID == uuid.Nil {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data_source_id is required")
	}
	source, err := s.queries.GetDataSource(ctx, dataSourceID)
	if err != nil {
		return sqlc.DataSource{}, mapNotFoundOrInternal(err, "data source not found")
	}
	if source.Type != "mysql" {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "thcpn standard station sync requires mysql data source")
	}
	if source.Status != "active" {
		return sqlc.DataSource{}, apperr.New(apperr.KindInvalidArgument, "data source is not active")
	}
	return source, nil
}

func validateTHCPNDeviceSyncInput(input thcpnDeviceSyncInput) error {
	if input.ActorUserID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.ExternalDeviceID <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "external_device_id is required")
	}
	if input.DeviceType != "" && !isValidTHCPNDeviceType(input.DeviceType) {
		return apperr.New(apperr.KindInvalidArgument, "invalid device_type")
	}
	if input.TargetWorkspaceID == uuid.Nil {
		if input.ProjectID != nil || input.SiteID != nil {
			return apperr.New(apperr.KindInvalidArgument, "target_workspace_id is required when project_id or site_id is set")
		}
		return nil
	}
	if input.SiteID != nil && input.ProjectID == nil {
		return apperr.New(apperr.KindInvalidArgument, "project_id is required when site_id is set")
	}
	return nil
}

func validateTHCPNGatewaySyncInput(input SyncTHCPNGatewayInput) (thcpnDeviceSyncInput, error) {
	gatewayInput := thcpnDeviceSyncInput{
		ExternalDeviceID: input.ExternalGatewayID,
		DeviceType:       "gateway",
		ActorUserID:      input.ActorUserID,
	}
	if err := validateTHCPNDeviceSyncInput(gatewayInput); err != nil {
		return thcpnDeviceSyncInput{}, err
	}
	return gatewayInput, nil
}

func (s *Service) syncTHCPNDevice(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, deviceDB *sql.DB, input thcpnDeviceSyncInput) (THCPNStandardStationSyncResult, error) {
	externalDevice, err := readTHCPNExternalDevice(ctx, deviceDB, input.ExternalDeviceID)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	externalConfig, err := readLatestTHCPNDeviceConfig(ctx, deviceDB, input.ExternalDeviceID)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	deviceRow, assignmentRow, created, err := s.upsertTHCPNPlatformDevice(ctx, q, source, input, externalDevice)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if err := s.syncTHCPNDeviceAvatars(ctx, q, deviceRow.ID, externalDevice.AvatarURLs); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if created {
		streamSpecs, err := buildTHCPNStreamSpecsForDevice(input.ExternalDeviceID, input.DeviceType, externalConfig.Data, externalConfig.Image)
		if err != nil {
			return THCPNStandardStationSyncResult{}, err
		}
		capabilities := capabilitiesForTHCPNStreams(streamSpecs)
		for _, capability := range capabilities {
			if err := addDeviceCapabilityIfMissing(ctx, q, deviceRow.ID, capability); err != nil {
				return THCPNStandardStationSyncResult{}, err
			}
		}
	}

	refRow, err := q.UpsertDeviceSourceRef(ctx, sqlc.UpsertDeviceSourceRefParams{
		DeviceID:         deviceRow.ID,
		DataSourceID:     source.ID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
	})
	if err != nil {
		return THCPNStandardStationSyncResult{}, mapWriteError(err, "upsert device source ref")
	}
	applied, err := applyTHCPNConfigToPlatform(ctx, q, source.ID, deviceRow.ID, input.ExternalDeviceID, externalConfig, input.ActorUserID, false)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	return THCPNStandardStationSyncResult{
		Device:         syncedDeviceFromSQL(deviceRow, assignmentRow),
		SourceRef:      deviceSourceRefFromSQL(refRow),
		ConfigSnapshot: applied.Snapshot,
		DataStreams:    applied.Streams,
		Bindings:       applied.Bindings,
		ExternalDevice: externalDevice.THCPNExternalDeviceMetadata,
	}, nil
}

type appliedTHCPNConfig struct {
	Snapshot         DeviceConfigSnapshot
	Streams          []SyncedDataStream
	Bindings         []DataStreamBinding
	DisabledStreams  []SyncedDataStream
	DisabledBindings []DataStreamBinding
}

func applyTHCPNConfigToPlatform(
	ctx context.Context,
	q *sqlc.Queries,
	dataSourceID uuid.UUID,
	deviceID uuid.UUID,
	externalDeviceID int64,
	externalConfig thcpnExternalConfig,
	actorUserID uuid.UUID,
	disableMissing bool,
) (appliedTHCPNConfig, error) {
	device, err := q.GetDevice(ctx, deviceID)
	if err != nil {
		return appliedTHCPNConfig{}, mapNotFoundOrInternal(err, "device not found")
	}
	streamSpecs, err := buildTHCPNStreamSpecsForDevice(externalDeviceID, device.DeviceType, externalConfig.Data, externalConfig.Image)
	if err != nil {
		return appliedTHCPNConfig{}, err
	}

	snapshotRow, err := q.UpsertDeviceConfigSnapshot(ctx, sqlc.UpsertDeviceConfigSnapshotParams{
		DeviceID:         deviceID,
		DataSourceID:     dataSourceID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: externalDeviceID,
		ExternalConfigID: externalConfig.ID,
		Version:          externalConfig.Version,
		DataJson:         []byte(externalConfig.Data),
		ImageJson:        []byte(externalConfig.Image),
		ControlJson:      []byte(externalConfig.Control),
		SourceCreatedAt:  timestamptzFromPtr(externalConfig.CreatedAt),
		SourceUpdatedAt:  timestamptzFromPtr(externalConfig.UpdatedAt),
	})
	if err != nil {
		return appliedTHCPNConfig{}, mapWriteError(err, "upsert device config snapshot")
	}

	streams := make([]SyncedDataStream, 0, len(streamSpecs))
	bindings := make([]DataStreamBinding, 0, len(streamSpecs))
	activeCodes := make([]string, 0, len(streamSpecs))
	for _, spec := range streamSpecs {
		streamRow, err := q.UpsertDataStreamFromSync(ctx, sqlc.UpsertDataStreamFromSyncParams{
			DeviceID:  deviceID,
			Code:      spec.Code,
			Name:      spec.Name,
			Type:      spec.Type,
			Unit:      optionalString(spec.Unit),
			CreatedBy: actorUserID,
		})
		if err != nil {
			return appliedTHCPNConfig{}, mapWriteError(err, "upsert data stream")
		}
		activeCodes = append(activeCodes, streamRow.Code)
		streams = append(streams, syncedDataStreamFromSQL(streamRow))

		binding, err := upsertTHCPNDataStreamBinding(ctx, q, dataSourceID, streamRow.ID, spec, actorUserID)
		if err != nil {
			return appliedTHCPNConfig{}, err
		}
		bindings = append(bindings, binding)
	}

	var disabledBindings []DataStreamBinding
	var disabledStreams []SyncedDataStream
	if disableMissing {
		disabledStreamRows, err := q.DisableMissingTHCPNDataStreams(ctx, sqlc.DisableMissingTHCPNDataStreamsParams{
			DeviceID:         deviceID,
			DataSourceID:     dataSourceID,
			ExternalDeviceID: externalDeviceID,
			ActiveCodes:      activeCodes,
		})
		if err != nil {
			return appliedTHCPNConfig{}, mapWriteError(err, "disable missing thcpn data streams")
		}
		disabledStreams = make([]SyncedDataStream, 0, len(disabledStreamRows))
		for _, row := range disabledStreamRows {
			disabledStreams = append(disabledStreams, syncedDataStreamFromSQL(row))
		}

		disabledBindingRows, err := q.DisableMissingTHCPNDataStreamBindings(ctx, sqlc.DisableMissingTHCPNDataStreamBindingsParams{
			DeviceID:         deviceID,
			DataSourceID:     dataSourceID,
			ExternalDeviceID: externalDeviceID,
			ActiveCodes:      activeCodes,
		})
		if err != nil {
			return appliedTHCPNConfig{}, mapWriteError(err, "disable missing thcpn data stream bindings")
		}
		disabledBindings = make([]DataStreamBinding, 0, len(disabledBindingRows))
		for _, row := range disabledBindingRows {
			disabledBindings = append(disabledBindings, bindingFromDisableMissingTHCPNRow(row))
		}
	}

	return appliedTHCPNConfig{
		Snapshot:         deviceConfigSnapshotFromSQL(snapshotRow),
		Streams:          streams,
		Bindings:         bindings,
		DisabledStreams:  disabledStreams,
		DisabledBindings: disabledBindings,
	}, nil
}

func validateTHCPNSyncTarget(ctx context.Context, q *sqlc.Queries, workspaceID uuid.UUID, projectID *uuid.UUID, siteID *uuid.UUID) error {
	if workspaceID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "target_workspace_id is required")
	}
	if _, err := q.GetWorkspace(ctx, workspaceID); err != nil {
		return mapNotFoundOrInternal(err, "target workspace not found")
	}
	if projectID != nil {
		project, err := q.GetProject(ctx, *projectID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target project not found")
		}
		if project.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "project_id does not belong to target workspace")
		}
	}
	if siteID != nil {
		site, err := q.GetSite(ctx, *siteID)
		if err != nil {
			return mapNotFoundOrInternal(err, "target site not found")
		}
		if site.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "site_id does not belong to target workspace")
		}
		if projectID != nil && site.ProjectID != *projectID {
			return apperr.New(apperr.KindInvalidArgument, "site_id does not belong to project_id")
		}
	}
	return nil
}

func (s *Service) upsertTHCPNPlatformDevice(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, input thcpnDeviceSyncInput, external thcpnExternalDevice) (sqlc.Device, *sqlc.DeviceAssignment, bool, error) {
	productID := strings.TrimSpace(input.ProductID)
	if productID == "" {
		productID = defaultTHCPNProductID
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = strings.TrimSpace(external.Name)
	}
	if name == "" && external.SN != nil {
		name = strings.TrimSpace(*external.SN)
	}
	if name == "" && external.UUID != nil {
		name = strings.TrimSpace(*external.UUID)
	}
	if name == "" {
		name = fmt.Sprintf("THCPN 设备 %d", input.ExternalDeviceID)
	}

	existingRef, err := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
		DataSourceID:     source.ID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
	})
	if err == nil {
		current, err := q.GetDevice(ctx, existingRef.DeviceID)
		if err != nil {
			return sqlc.Device{}, nil, false, mapNotFoundOrInternal(err, "mapped device not found")
		}
		device, err := q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{
			ID:        current.ID,
			ProductID: optionalString(productID),
			Name:      name,
			Status:    current.Status,
		})
		if err != nil {
			return sqlc.Device{}, nil, false, mapWriteError(err, "update synced device")
		}
		device, err = updateSyncedDeviceType(ctx, q, device, input.DeviceType)
		if err != nil {
			return sqlc.Device{}, nil, false, err
		}
		assignment, err := syncAssignmentIfRequested(ctx, q, device.ID, input)
		if err != nil {
			return sqlc.Device{}, nil, false, err
		}
		return device, assignment, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Device{}, nil, false, apperr.Wrap(apperr.KindInternal, "lookup device source ref", err)
	}

	device, err := q.CreateDevice(ctx, sqlc.CreateDeviceParams{
		ProductID: optionalString(productID),
		Name:      name,
	})
	if err != nil {
		return sqlc.Device{}, nil, false, mapWriteError(err, "create synced device")
	}
	device, err = updateSyncedDeviceType(ctx, q, device, input.DeviceType)
	if err != nil {
		return sqlc.Device{}, nil, false, err
	}
	assignment, err := syncAssignmentIfRequested(ctx, q, device.ID, input)
	if err != nil {
		return sqlc.Device{}, nil, false, err
	}
	return device, assignment, true, nil
}

func updateSyncedDeviceType(ctx context.Context, q *sqlc.Queries, device sqlc.Device, deviceType string) (sqlc.Device, error) {
	normalized := strings.TrimSpace(deviceType)
	if normalized == "" {
		normalized = "standalone"
	}
	if device.DeviceType == normalized {
		return device, nil
	}
	updated, err := q.UpdateDeviceType(ctx, sqlc.UpdateDeviceTypeParams{
		ID:         device.ID,
		DeviceType: normalized,
	})
	if err != nil {
		return sqlc.Device{}, mapWriteError(err, "update synced device type")
	}
	return updated, nil
}

func isValidTHCPNDeviceType(value string) bool {
	switch value {
	case "standalone", "gateway", "gateway_node":
		return true
	default:
		return false
	}
}

func syncAssignmentIfRequested(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, input thcpnDeviceSyncInput) (*sqlc.DeviceAssignment, error) {
	current, err := q.GetActiveDeviceAssignment(ctx, deviceID)
	if input.TargetWorkspaceID == uuid.Nil {
		if err == nil {
			return &current, nil
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	if err == nil {
		if current.WorkspaceID != input.TargetWorkspaceID {
			return nil, apperr.New(apperr.KindConflict, "external device is already assigned to another workspace")
		}
		projectID := current.ProjectID
		siteID := current.SiteID
		if input.ProjectID != nil {
			projectID = input.ProjectID
			if input.SiteID == nil {
				siteID = nil
			}
		}
		if input.SiteID != nil {
			siteID = input.SiteID
		}
		assignment, err := q.UpdateDeviceAssignment(ctx, sqlc.UpdateDeviceAssignmentParams{
			ID:        current.ID,
			ProjectID: projectID,
			SiteID:    siteID,
		})
		if err != nil {
			return nil, mapWriteError(err, "update synced device assignment")
		}
		return &assignment, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, mapNotFoundOrInternal(err, "active device assignment not found")
	}
	assignment, err := q.CreateDeviceAssignment(ctx, sqlc.CreateDeviceAssignmentParams{
		DeviceID:       deviceID,
		WorkspaceID:    input.TargetWorkspaceID,
		ProjectID:      input.ProjectID,
		SiteID:         input.SiteID,
		AssignedBy:     &input.ActorUserID,
		AssignedByType: "system_admin",
	})
	if err != nil {
		return nil, mapWriteError(err, "assign synced device")
	}
	return &assignment, nil
}

func readTHCPNGateNodes(ctx context.Context, db *sql.DB, externalGatewayID int64) ([]int64, error) {
	const query = `
SELECT node_id
FROM gate_node AS relation
WHERE relation.gate_id = ?
  AND relation.deleted_at IS NULL
  AND relation.id = (
      SELECT MAX(latest.id)
      FROM gate_node AS latest
      WHERE latest.node_id = relation.node_id
        AND latest.deleted_at IS NULL
  )
ORDER BY node_id ASC`
	rows, err := db.QueryContext(ctx, query, externalGatewayID)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn gate nodes", err)
	}
	defer rows.Close()

	nodeIDs := make([]int64, 0)
	seen := map[int64]struct{}{}
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn gate node", err)
		}
		if nodeID <= 0 {
			continue
		}
		if _, ok := seen[nodeID]; ok {
			continue
		}
		seen[nodeID] = struct{}{}
		nodeIDs = append(nodeIDs, nodeID)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn gate nodes", err)
	}
	return nodeIDs, nil
}

func readTHCPNExternalDevice(ctx context.Context, db *sql.DB, externalDeviceID int64) (thcpnExternalDevice, error) {
	const query = `
SELECT
  id,
  COALESCE(name, ''),
  CAST(iccid AS CHAR),
  CAST(version AS CHAR),
  CAST(status AS CHAR),
  CAST(device_type AS CHAR),
  active,
  CAST(sn AS CHAR),
  CAST(uuid AS CHAR),
  CAST(current_device_version AS CHAR),
  CAST(lat AS CHAR),
  CAST(lon AS CHAR),
  CAST(alt AS CHAR),
  CAST(avatar AS CHAR),
  created_at,
  updated_at
FROM devices
WHERE id = ?
  AND deleted_at IS NULL
LIMIT 1`
	var row thcpnExternalDevice
	var iccid, version, status, deviceType, sn, externalUUID, currentDeviceVersion sql.NullString
	var active sql.NullInt64
	var latitude, longitude, altitude, avatar sql.NullString
	var createdAt, updatedAt sql.NullTime
	if err := db.QueryRowContext(ctx, query, externalDeviceID).Scan(
		&row.ID,
		&row.Name,
		&iccid,
		&version,
		&status,
		&deviceType,
		&active,
		&sn,
		&externalUUID,
		&currentDeviceVersion,
		&latitude,
		&longitude,
		&altitude,
		&avatar,
		&createdAt,
		&updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return thcpnExternalDevice{}, apperr.New(apperr.KindNotFound, "thcpn external device not found")
		}
		return thcpnExternalDevice{}, apperr.Wrap(apperr.KindDataSource, "read thcpn external device", err)
	}
	row.ICCID = nullStringPtr(iccid)
	row.Version = nullStringPtr(version)
	row.Status = nullStringPtr(status)
	row.DeviceType = nullStringPtr(deviceType)
	row.Active = nullInt64Ptr(active)
	row.SN = nullStringPtr(sn)
	row.UUID = nullStringPtr(externalUUID)
	row.CurrentDeviceVersion = nullStringPtr(currentDeviceVersion)
	row.Latitude = parseSourceCoordinate(latitude, -90, 90)
	row.Longitude = parseSourceCoordinate(longitude, -180, 180)
	if row.Latitude != nil && row.Longitude != nil && *row.Latitude == 0 && *row.Longitude == 0 {
		row.Latitude, row.Longitude = nil, nil
	}
	row.AltitudeM = parseSourceNumber(altitude)
	if avatar.Valid && strings.TrimSpace(avatar.String) != "" {
		_ = json.Unmarshal([]byte(avatar.String), &row.AvatarURLs)
	}
	row.CreatedAt = nullTimePtr(createdAt)
	row.UpdatedAt = nullTimePtr(updatedAt)
	return row, nil
}

func (s *Service) syncTHCPNDeviceAvatars(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, avatarURLs []string) error {
	if len(avatarURLs) == 0 {
		return nil
	}
	existing, err := q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil {
		return apperr.Wrap(apperr.KindInternal, "list synced device images", err)
	}
	existingKeys := make(map[string]struct{}, len(existing))
	for _, image := range existing {
		existingKeys[image.ObjectKey] = struct{}{}
	}
	remaining := 12 - len(existing)
	seenURLs := make(map[string]struct{}, len(avatarURLs))
	for _, rawURL := range avatarURLs {
		imageURL := strings.TrimSpace(strings.ReplaceAll(rawURL, `\/`, `/`))
		if imageURL == "" || remaining <= 0 {
			continue
		}
		if _, seen := seenURLs[imageURL]; seen {
			continue
		}
		seenURLs[imageURL] = struct{}{}
		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(imageURL)))
		objectKeyPrefix := fmt.Sprintf("device-profiles/%s/thcpn-%s", deviceID, hash)
		alreadySynced := false
		for key := range existingKeys {
			if strings.HasPrefix(key, objectKeyPrefix+".") {
				alreadySynced = true
				break
			}
		}
		if alreadySynced {
			continue
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
		if err != nil {
			return apperr.Wrap(apperr.KindDataSource, "build thcpn device image request", err)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			return apperr.Wrap(apperr.KindDataSource, "download thcpn device image", err)
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 10*1024*1024+1))
		response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 || len(data) == 0 || len(data) > 10<<20 {
			return apperr.New(apperr.KindDataSource, "downloaded thcpn device image is invalid")
		}
		contentType := http.DetectContentType(data)
		extension := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[contentType]
		if extension == "" {
			return apperr.New(apperr.KindDataSource, "thcpn device avatar is not a supported image")
		}
		objectKey := objectKeyPrefix + extension
		parsedURL, _ := url.Parse(imageURL)
		filename := path.Base(parsedURL.Path)
		if filename == "." || filename == "/" || filename == "" {
			filename = "thcpn-device" + extension
		}
		_, err = q.CreateDeviceProfileImage(ctx, sqlc.CreateDeviceProfileImageParams{
			DeviceID: deviceID, ObjectKey: objectKey, OriginalFilename: filename, ContentType: contentType,
			SizeBytes: int64(len(data)), SortOrder: int32(len(existing)), IsCover: len(existing) == 0,
			UploadedBy: nil, SourceUrl: &imageURL, Caption: nil,
		})
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "create synced device image", err)
		}
		existing = append(existing, sqlc.DeviceProfileImage{ObjectKey: objectKey})
		existingKeys[objectKey] = struct{}{}
		remaining--
	}
	return nil
}

func validCoordinate(value sql.NullFloat64, min, max float64) *float64 {
	if !value.Valid || math.IsNaN(value.Float64) || math.IsInf(value.Float64, 0) || value.Float64 < min || value.Float64 > max {
		return nil
	}
	result := value.Float64
	return &result
}

func validFiniteNumber(value sql.NullFloat64) *float64 {
	if !value.Valid || math.IsNaN(value.Float64) || math.IsInf(value.Float64, 0) {
		return nil
	}
	result := value.Float64
	return &result
}

func readAllTHCPNExternalDevices(ctx context.Context, db *sql.DB) ([]thcpnExternalDeviceIndex, error) {
	const query = `
SELECT id, CAST(device_type AS CHAR)
FROM devices
WHERE deleted_at IS NULL
ORDER BY id ASC`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn external devices", err)
	}
	defer rows.Close()
	devices := make([]thcpnExternalDeviceIndex, 0)
	for rows.Next() {
		var device thcpnExternalDeviceIndex
		var deviceType sql.NullString
		if err := rows.Scan(&device.ID, &deviceType); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn external device", err)
		}
		device.DeviceType = deviceType.String
		if device.ID > 0 {
			devices = append(devices, device)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn external devices", err)
	}
	return devices, nil
}

type thcpnCameraScanner interface {
	Scan(...any) error
}

func scanTHCPNExternalCamera(scanner thcpnCameraScanner) (THCPNExternalCamera, error) {
	var camera THCPNExternalCamera
	var createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(
		&camera.ID, &camera.DeviceSerial, &camera.Name, &camera.Channel, &camera.Poster, &createdAt, &updatedAt,
	); err != nil {
		return THCPNExternalCamera{}, err
	}
	camera.CreatedAt = nullTimePtr(createdAt)
	camera.UpdatedAt = nullTimePtr(updatedAt)
	return camera, nil
}

func readTHCPNExternalCamera(ctx context.Context, db *sql.DB, externalCameraID int64) (THCPNExternalCamera, error) {
	const query = `
SELECT id, device_serial, COALESCE(name, ''), channel, poster, created_at, updated_at
FROM cameras
WHERE id = ?
  AND deleted_at IS NULL
LIMIT 1`
	camera, err := scanTHCPNExternalCamera(db.QueryRowContext(ctx, query, externalCameraID))
	if errors.Is(err, sql.ErrNoRows) {
		return THCPNExternalCamera{}, apperr.New(apperr.KindNotFound, "thcpn external camera not found")
	}
	if err != nil {
		return THCPNExternalCamera{}, apperr.Wrap(apperr.KindDataSource, "read thcpn external camera", err)
	}
	return camera, nil
}

func readAllTHCPNExternalCameras(ctx context.Context, db *sql.DB) ([]THCPNExternalCamera, error) {
	const query = `
SELECT id, device_serial, COALESCE(name, ''), channel, poster, created_at, updated_at
FROM cameras
WHERE deleted_at IS NULL
ORDER BY id ASC`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn external cameras", err)
	}
	defer rows.Close()
	items := make([]THCPNExternalCamera, 0)
	for rows.Next() {
		camera, err := scanTHCPNExternalCamera(rows)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn external camera", err)
		}
		items = append(items, camera)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn external cameras", err)
	}
	return items, nil
}

func readAllTHCPNGatewayTopology(ctx context.Context, db *sql.DB) ([]thcpnGatewayTopology, error) {
	const query = `
SELECT gateways.gate_id, active_nodes.node_id
FROM (
    SELECT DISTINCT gate_id
    FROM gate_node
    WHERE gate_id > 0
) AS gateways
LEFT JOIN gate_node AS active_nodes
  ON active_nodes.gate_id = gateways.gate_id
 AND active_nodes.deleted_at IS NULL
 AND active_nodes.id = (
     SELECT MAX(latest.id)
     FROM gate_node AS latest
     WHERE latest.node_id = active_nodes.node_id
       AND latest.deleted_at IS NULL
 )
ORDER BY gateways.gate_id ASC, active_nodes.node_id ASC`
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn gateway topology", err)
	}
	defer rows.Close()

	items := make([]thcpnGatewayTopology, 0)
	indexByGateway := make(map[int64]int)
	seen := make(map[[2]int64]struct{})
	for rows.Next() {
		var gatewayID int64
		var nodeID sql.NullInt64
		if err := rows.Scan(&gatewayID, &nodeID); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan thcpn gateway topology", err)
		}
		index, exists := indexByGateway[gatewayID]
		if !exists && gatewayID > 0 {
			index = len(items)
			indexByGateway[gatewayID] = index
			items = append(items, thcpnGatewayTopology{GatewayID: gatewayID, NodeIDs: []int64{}})
		}
		if gatewayID <= 0 || !nodeID.Valid || nodeID.Int64 <= 0 || gatewayID == nodeID.Int64 {
			continue
		}
		pair := [2]int64{gatewayID, nodeID.Int64}
		if _, exists := seen[pair]; exists {
			continue
		}
		seen[pair] = struct{}{}
		items[index].NodeIDs = append(items[index].NodeIDs, nodeID.Int64)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read thcpn gateway topology", err)
	}
	return items, nil
}

func indexTHCPNTopology(topology []thcpnGatewayTopology) (map[int64]struct{}, map[int64]struct{}) {
	gateways := make(map[int64]struct{}, len(topology))
	nodes := make(map[int64]struct{})
	for _, item := range topology {
		gateways[item.GatewayID] = struct{}{}
		for _, nodeID := range item.NodeIDs {
			nodes[nodeID] = struct{}{}
		}
	}
	return gateways, nodes
}

func syncedTHCPNDeviceType(device thcpnExternalDeviceIndex, gateways, nodes map[int64]struct{}) string {
	if _, exists := gateways[device.ID]; exists {
		return "gateway"
	}
	if _, exists := nodes[device.ID]; exists {
		return "gateway_node"
	}
	return platformTHCPNDeviceType(device.DeviceType)
}

func (s *Service) syncTHCPNTopology(
	ctx context.Context,
	dataSourceID uuid.UUID,
	topology []thcpnGatewayTopology,
) (int, []THCPNDeviceSyncFailure) {
	relationCount := 0
	failures := make([]THCPNDeviceSyncFailure, 0)
	for _, item := range topology {
		tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: apperr.MessageOf(err)})
			continue
		}
		q := s.queries.WithTx(tx)
		parent, err := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
			DataSourceID: dataSourceID, AdapterCode: AdapterTHCPNLegacy, ExternalDeviceID: item.GatewayID,
		})
		if err != nil {
			_ = tx.Rollback(ctx)
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: "gateway was not synchronized"})
			continue
		}
		complete := true
		for _, nodeID := range item.NodeIDs {
			child, err := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
				DataSourceID: dataSourceID, AdapterCode: AdapterTHCPNLegacy, ExternalDeviceID: nodeID,
			})
			if err != nil {
				failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: nodeID, Error: "gateway node was not synchronized"})
				complete = false
				break
			}
			if _, err := q.UpsertDeviceRelation(ctx, sqlc.UpsertDeviceRelationParams{
				ParentDeviceID: parent.DeviceID, ChildDeviceID: child.DeviceID, RelationType: "gateway_node",
				DataSourceID: dataSourceID, ExternalParentDeviceID: item.GatewayID, ExternalChildDeviceID: nodeID,
			}); err != nil {
				failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: nodeID, Error: apperr.MessageOf(err)})
				complete = false
				break
			}
		}
		if !complete {
			_ = tx.Rollback(ctx)
			continue
		}
		if _, err := q.MarkMissingDeviceRelationsRemoved(ctx, sqlc.MarkMissingDeviceRelationsRemovedParams{
			DataSourceID: dataSourceID, ExternalParentDeviceID: item.GatewayID, ActiveChildIds: item.NodeIDs,
		}); err != nil {
			_ = tx.Rollback(ctx)
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: apperr.MessageOf(err)})
			continue
		}
		if err := tx.Commit(ctx); err != nil {
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: apperr.MessageOf(err)})
			continue
		}
		relationCount += len(item.NodeIDs)
	}
	return relationCount, failures
}

func platformTHCPNDeviceType(externalType string) string {
	value, err := strconv.ParseInt(strings.TrimSpace(externalType), 10, 64)
	if err != nil {
		return "standalone"
	}
	if value == 10 {
		return "gateway"
	}
	if value > 10 {
		return "gateway_node"
	}
	return "standalone"
}

func readLatestTHCPNDeviceConfig(ctx context.Context, db thcpnConfigQuerier, externalDeviceID int64) (thcpnExternalConfig, error) {
	const query = `
SELECT id, device_id, data, image, control, CAST(version AS CHAR), CAST(uuid AS CHAR), is_mg, created_at, updated_at
FROM device_config
WHERE device_id = ?
  AND deleted_at IS NULL
ORDER BY id DESC
LIMIT 1`
	row, err := scanTHCPNDeviceConfig(db.QueryRowContext(ctx, query, externalDeviceID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return thcpnExternalConfig{}, apperr.New(apperr.KindNotFound, "thcpn device config not found")
		}
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "read thcpn device config", err)
	}
	return row, nil
}

func readLatestTHCPNDeviceConfigForUpdate(ctx context.Context, db thcpnConfigQuerier, externalDeviceID int64) (thcpnExternalConfig, error) {
	const query = `
SELECT id, device_id, data, image, control, CAST(version AS CHAR), CAST(uuid AS CHAR), is_mg, created_at, updated_at
FROM device_config
WHERE device_id = ?
  AND deleted_at IS NULL
ORDER BY id DESC
LIMIT 1
FOR UPDATE`
	row, err := scanTHCPNDeviceConfig(db.QueryRowContext(ctx, query, externalDeviceID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return thcpnExternalConfig{}, apperr.New(apperr.KindNotFound, "thcpn device config not found")
		}
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "lock thcpn device config", err)
	}
	return row, nil
}

func readTHCPNDeviceConfigByID(ctx context.Context, db thcpnConfigQuerier, externalConfigID int64) (thcpnExternalConfig, error) {
	const query = `
SELECT id, device_id, data, image, control, CAST(version AS CHAR), CAST(uuid AS CHAR), is_mg, created_at, updated_at
FROM device_config
WHERE id = ?
LIMIT 1`
	row, err := scanTHCPNDeviceConfig(db.QueryRowContext(ctx, query, externalConfigID))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return thcpnExternalConfig{}, apperr.New(apperr.KindNotFound, "thcpn device config not found")
		}
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "read thcpn device config", err)
	}
	return row, nil
}

func scanTHCPNDeviceConfig(row *sql.Row) (thcpnExternalConfig, error) {
	var result thcpnExternalConfig
	var dataRaw, imageRaw, controlRaw sql.NullString
	var version, externalUUID sql.NullString
	var isMG sql.NullInt64
	var createdAt, updatedAt sql.NullTime
	if err := row.Scan(
		&result.ID,
		&result.DeviceID,
		&dataRaw,
		&imageRaw,
		&controlRaw,
		&version,
		&externalUUID,
		&isMG,
		&createdAt,
		&updatedAt,
	); err != nil {
		return thcpnExternalConfig{}, err
	}
	dataJSON, err := normalizeTHCPNJSON(dataRaw, []byte("[]"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.data")
	}
	imageJSON, err := normalizeTHCPNJSON(imageRaw, []byte("[]"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.image")
	}
	controlJSON, err := normalizeTHCPNJSON(controlRaw, []byte("{}"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.control")
	}
	result.Data = dataJSON
	result.Image = imageJSON
	result.Control = controlJSON
	result.Version = nullStringPtr(version)
	result.UUID = nullStringPtr(externalUUID)
	result.IsMG = isMG.Valid && isMG.Int64 != 0
	result.CreatedAt = nullTimePtr(createdAt)
	result.UpdatedAt = nullTimePtr(updatedAt)
	return result, nil
}

func insertTHCPNDeviceConfig(ctx context.Context, tx *sql.Tx, previous thcpnExternalConfig, dataJSON json.RawMessage, imageJSON json.RawMessage, controlJSON json.RawMessage) (thcpnExternalConfig, error) {
	const query = `
INSERT INTO device_config (device_id, data, image, control, version, uuid, is_mg, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`
	result, err := tx.ExecContext(
		ctx,
		query,
		previous.DeviceID,
		string(dataJSON),
		string(imageJSON),
		string(controlJSON),
		nullableStringArg(previous.Version),
		nullableStringArg(previous.UUID),
		boolInt(previous.IsMG),
	)
	if err != nil {
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "insert thcpn device config", err)
	}
	insertedID, err := result.LastInsertId()
	if err != nil {
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "read inserted thcpn device config id", err)
	}
	inserted, err := readTHCPNDeviceConfigByID(ctx, tx, insertedID)
	if err != nil {
		return thcpnExternalConfig{}, err
	}
	return inserted, nil
}

func buildTHCPNStreamSpecs(externalDeviceID int64, dataJSON json.RawMessage, imageJSON json.RawMessage) ([]thcpnStreamSpec, error) {
	return buildTHCPNStreamSpecsForDevice(externalDeviceID, "standalone", dataJSON, imageJSON)
}

func buildTHCPNStreamSpecsForDevice(externalDeviceID int64, deviceType string, dataJSON json.RawMessage, imageJSON json.RawMessage) ([]thcpnStreamSpec, error) {
	specs := make([]thcpnStreamSpec, 0)
	usedCodes := map[string]int{}
	shardStrategy := thcpnShardStrategyForDeviceType(deviceType)

	dataSpecs, err := buildTHCPNTelemetryStreamSpecs(externalDeviceID, shardStrategy, dataJSON, usedCodes)
	if err != nil {
		return nil, err
	}
	specs = append(specs, dataSpecs...)

	imageSpecs, err := buildTHCPNImageStreamSpecs(externalDeviceID, shardStrategy, imageJSON, usedCodes)
	if err != nil {
		return nil, err
	}
	specs = append(specs, imageSpecs...)
	return specs, nil
}

func buildTHCPNTelemetryStreamSpecs(externalDeviceID int64, shardStrategy string, raw json.RawMessage, usedCodes map[string]int) ([]thcpnStreamSpec, error) {
	var sensors []struct {
		Desc       string `json:"desc"`
		SensorType string `json:"sensorType"`
		Params     struct {
			Contents []struct {
				Key  string `json:"key"`
				Info struct {
					Name string `json:"name"`
					Type string `json:"type"`
					Unit string `json:"unit"`
				} `json:"info"`
			} `json:"contents"`
		} `json:"params"`
	}
	if len(raw) == 0 {
		raw = []byte("[]")
	}
	if err := json.Unmarshal(raw, &sensors); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "parse thcpn device_config.data")
	}

	specs := make([]thcpnStreamSpec, 0)
	for _, sensor := range sensors {
		for _, content := range sensor.Params.Contents {
			key := strings.TrimSpace(content.Key)
			if key == "" {
				continue
			}
			name := strings.TrimSpace(content.Info.Name)
			if name == "" {
				name = strings.TrimSpace(sensor.Desc)
			}
			if name == "" {
				name = key
			}
			cfg := thcpnTelemetryAdapterConfig(externalDeviceID, shardStrategy, key)
			specs = append(specs, thcpnStreamSpec{
				Code:          nextTHCPNStreamCode(key, usedCodes),
				Name:          name,
				Type:          "telemetry",
				Unit:          strings.TrimSpace(content.Info.Unit),
				JSONKey:       key,
				PayloadType:   "columns",
				AdapterConfig: cfg,
			})
		}
	}
	return specs, nil
}

func buildTHCPNImageStreamSpecs(externalDeviceID int64, shardStrategy string, raw json.RawMessage, usedCodes map[string]int) ([]thcpnStreamSpec, error) {
	var images []struct {
		Key  string `json:"key"`
		Dest string `json:"dest"`
		Name string `json:"name"`
		Desc string `json:"desc"`
	}
	if len(raw) == 0 {
		raw = []byte("[]")
	}
	if err := json.Unmarshal(raw, &images); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "parse thcpn device_config.image")
	}

	specs := make([]thcpnStreamSpec, 0)
	for _, image := range images {
		key := strings.TrimSpace(image.Key)
		if key == "" {
			continue
		}
		name := firstNonEmpty(image.Name, image.Dest, image.Desc, key)
		cfg := thcpnImageAdapterConfig(externalDeviceID, shardStrategy, key)
		specs = append(specs, thcpnStreamSpec{
			Code:          nextTHCPNStreamCode(key, usedCodes),
			Name:          name,
			Type:          "image",
			JSONKey:       key,
			PayloadType:   "media",
			AdapterConfig: cfg,
		})
	}
	return specs, nil
}

func thcpnTelemetryAdapterConfig(externalDeviceID int64, shardStrategy string, jsonKey string) json.RawMessage {
	return marshalAdapterConfig(map[string]any{
		"external_device_id": externalDeviceID,
		"shard_strategy":     shardStrategy,
		"row_type":           "data",
		"json_key":           jsonKey,
		"value_path":         thcpnJSONValuePath(jsonKey),
		"table_index":        defaultTHCPNTableIndexField,
		"table_name_field":   defaultTHCPNTableNameField,
		"index_start_field":  defaultTHCPNIndexStartField,
		"index_end_field":    defaultTHCPNIndexEndField,
		"time_field":         defaultTHCPNTimeField,
	})
}

func thcpnImageAdapterConfig(externalDeviceID int64, shardStrategy string, imageKey string) json.RawMessage {
	return marshalAdapterConfig(map[string]any{
		"external_device_id": externalDeviceID,
		"shard_strategy":     shardStrategy,
		"row_type":           "image",
		"image_key":          imageKey,
		"object_key_path":    thcpnJSONValuePath(imageKey),
		"media_type":         "image",
		"public_url_prefix":  defaultTHCPNMediaPublicURLPrefix,
		"table_index":        defaultTHCPNTableIndexField,
		"table_name_field":   defaultTHCPNTableNameField,
		"index_start_field":  defaultTHCPNIndexStartField,
		"index_end_field":    defaultTHCPNIndexEndField,
		"time_field":         defaultTHCPNTimeField,
	})
}

func thcpnShardStrategyForDeviceType(deviceType string) string {
	switch strings.TrimSpace(deviceType) {
	case "gateway", "gateway_node":
		return thcpnShardStrategyIndex
	default:
		return thcpnShardStrategyCutover
	}
}

func upsertTHCPNDataStreamBinding(ctx context.Context, q *sqlc.Queries, sourceID uuid.UUID, dataStreamID uuid.UUID, spec thcpnStreamSpec, actorUserID uuid.UUID) (DataStreamBinding, error) {
	input := CreateDataStreamBindingInput{
		DataStreamID:      dataStreamID,
		DataSourceID:      sourceID,
		AdapterCode:       AdapterTHCPNLegacy,
		PayloadType:       spec.PayloadType,
		AdapterConfigJSON: spec.AdapterConfig,
		ActorUserID:       actorUserID,
	}
	normalized, err := normalizeBinding(input, "active")
	if err != nil {
		return DataStreamBinding{}, err
	}

	current, err := q.GetActiveDataStreamBinding(ctx, dataStreamID)
	if err == nil {
		updated, err := q.UpdateDataStreamBinding(ctx, sqlc.UpdateDataStreamBindingParams{
			ID:                current.ID,
			DataSourceID:      sourceID,
			AdapterCode:       normalized.AdapterCode,
			DatabaseName:      normalized.DatabaseName,
			SchemaName:        normalized.SchemaName,
			TableName:         normalized.TableName,
			DeviceKeyField:    normalized.DeviceKeyField,
			DeviceKeyValue:    normalized.DeviceKeyValue,
			TimeField:         normalized.TimeField,
			ValueField:        normalized.ValueField,
			PayloadType:       normalized.PayloadType,
			AdapterConfigJson: normalized.AdapterConfigJSON,
			Status:            normalized.Status,
		})
		if err != nil {
			return DataStreamBinding{}, mapWriteError(err, "update thcpn data stream binding")
		}
		return bindingFromUpdateRow(updated), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return DataStreamBinding{}, apperr.Wrap(apperr.KindInternal, "lookup active data stream binding", err)
	}

	created, err := q.CreateDataStreamBinding(ctx, sqlc.CreateDataStreamBindingParams{
		DataStreamID:      dataStreamID,
		DataSourceID:      sourceID,
		AdapterCode:       normalized.AdapterCode,
		DatabaseName:      normalized.DatabaseName,
		SchemaName:        normalized.SchemaName,
		TableName:         normalized.TableName,
		DeviceKeyField:    normalized.DeviceKeyField,
		DeviceKeyValue:    normalized.DeviceKeyValue,
		TimeField:         normalized.TimeField,
		ValueField:        normalized.ValueField,
		PayloadType:       normalized.PayloadType,
		AdapterConfigJson: normalized.AdapterConfigJSON,
		CreatedBy:         actorUserID,
		CreatedByType:     "system_admin",
	})
	if err != nil {
		return DataStreamBinding{}, mapWriteError(err, "create thcpn data stream binding")
	}
	return bindingFromCreateRow(created), nil
}

func capabilitiesForTHCPNStreams(specs []thcpnStreamSpec) []string {
	seen := map[string]struct{}{"configurable": {}}
	for _, spec := range specs {
		switch spec.Type {
		case "telemetry":
			seen["telemetry"] = struct{}{}
		case "image":
			seen["image_capture"] = struct{}{}
		}
	}
	capabilities := make([]string, 0, len(seen))
	for capability := range seen {
		capabilities = append(capabilities, capability)
	}
	return capabilities
}

func addDeviceCapabilityIfMissing(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, capability string) error {
	_, err := q.AddDeviceCapability(ctx, sqlc.AddDeviceCapabilityParams{
		DeviceID:       deviceID,
		CapabilityCode: capability,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return mapWriteError(err, "add device capability")
	}
	return nil
}

func normalizeTHCPNJSON(value sql.NullString, fallback []byte) (json.RawMessage, error) {
	if !value.Valid || strings.TrimSpace(value.String) == "" || strings.TrimSpace(value.String) == "null" {
		return append(json.RawMessage(nil), fallback...), nil
	}
	raw := []byte(strings.TrimSpace(value.String))
	if json.Valid(raw) {
		var decoded string
		if len(raw) > 0 && raw[0] == '"' && json.Unmarshal(raw, &decoded) == nil && json.Valid([]byte(decoded)) {
			return json.RawMessage(decoded), nil
		}
		return append(json.RawMessage(nil), raw...), nil
	}
	return nil, apperr.New(apperr.KindDataSource, "invalid JSON")
}

func normalizeTHCPNConfigArrayJSON(raw json.RawMessage, field string) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, field+" is required")
	}
	var value []any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "normalize "+field, err)
	}
	return json.RawMessage(normalized), nil
}

func normalizeTHCPNConfigObjectJSON(raw json.RawMessage, field string) (json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, apperr.New(apperr.KindInvalidArgument, field+" is required")
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "invalid "+field)
	}
	normalized, err := json.Marshal(value)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindInternal, "normalize "+field, err)
	}
	return json.RawMessage(normalized), nil
}

func thcpnDeviceConfigFromExternal(config thcpnExternalConfig) THCPNDeviceConfig {
	return THCPNDeviceConfig{
		ID:          config.ID,
		DeviceID:    config.DeviceID,
		Version:     config.Version,
		UUID:        config.UUID,
		IsMG:        config.IsMG,
		DataJSON:    config.Data,
		ImageJSON:   config.Image,
		ControlJSON: config.Control,
		CreatedAt:   config.CreatedAt,
		UpdatedAt:   config.UpdatedAt,
	}
}

func nullableStringArg(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func capabilitiesForSyncedTHCPNStreams(streams []SyncedDataStream) []string {
	seen := map[string]struct{}{"configurable": {}}
	for _, stream := range streams {
		switch stream.Type {
		case "telemetry":
			seen["telemetry"] = struct{}{}
		case "image":
			seen["image_capture"] = struct{}{}
		}
	}
	capabilities := make([]string, 0, len(seen))
	for capability := range seen {
		capabilities = append(capabilities, capability)
	}
	return capabilities
}

func nextTHCPNStreamCode(key string, used map[string]int) string {
	key = strings.TrimSpace(key)
	if key == "" {
		key = "stream"
	}
	used[key]++
	if used[key] == 1 {
		return key
	}
	return fmt.Sprintf("%s_%d", key, used[key])
}

func marshalAdapterConfig(value map[string]any) json.RawMessage {
	encoded, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return encoded
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	trimmed := strings.TrimSpace(value.String)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func timestamptzFromPtr(value *time.Time) pgtype.Timestamptz {
	if value == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *value, Valid: true}
}

func pgTimePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func syncedDeviceFromSQL(model sqlc.Device, assignment *sqlc.DeviceAssignment) SyncedDevice {
	device := SyncedDevice{
		ID:         model.ID,
		ProductID:  model.ProductID,
		SerialNo:   model.SerialNo,
		Name:       model.Name,
		Status:     model.Status,
		DeviceType: model.DeviceType,
		CreatedAt:  pgTime(model.CreatedAt),
		UpdatedAt:  pgTime(model.UpdatedAt),
	}
	if assignment != nil {
		device.AssignmentID = &assignment.ID
		device.WorkspaceID = &assignment.WorkspaceID
		device.ProjectID = assignment.ProjectID
		device.SiteID = assignment.SiteID
		device.AssignedBy = assignment.AssignedBy
		device.AssignedAt = pgTimePtr(assignment.AssignedAt)
	}
	return device
}

func syncedDataStreamFromSQL(model sqlc.DataStream) SyncedDataStream {
	return SyncedDataStream{
		ID:       model.ID,
		DeviceID: model.DeviceID,
		Code:     model.Code,
		Name:     model.Name,
		Type:     model.Type,
		Unit:     model.Unit,
		Status:   model.Status,
	}
}

func deviceSourceRefFromSQL(model sqlc.DeviceSourceRef) DeviceSourceRef {
	return DeviceSourceRef{
		ID:               model.ID,
		DeviceID:         model.DeviceID,
		DataSourceID:     model.DataSourceID,
		AdapterCode:      model.AdapterCode,
		ExternalDeviceID: model.ExternalDeviceID,
		Status:           model.Status,
		SyncedAt:         pgTime(model.SyncedAt),
		CreatedAt:        pgTime(model.CreatedAt),
		UpdatedAt:        pgTime(model.UpdatedAt),
	}
}

func deviceConfigSnapshotFromSQL(model sqlc.DeviceConfigSnapshot) DeviceConfigSnapshot {
	return DeviceConfigSnapshot{
		ID:               model.ID,
		DeviceID:         model.DeviceID,
		DataSourceID:     model.DataSourceID,
		AdapterCode:      model.AdapterCode,
		ExternalDeviceID: model.ExternalDeviceID,
		ExternalConfigID: model.ExternalConfigID,
		Version:          model.Version,
		DataJSON:         json.RawMessage(model.DataJson),
		ImageJSON:        json.RawMessage(model.ImageJson),
		ControlJSON:      json.RawMessage(model.ControlJson),
		SourceCreatedAt:  pgTimePtr(model.SourceCreatedAt),
		SourceUpdatedAt:  pgTimePtr(model.SourceUpdatedAt),
		SyncedAt:         pgTime(model.SyncedAt),
		CreatedAt:        pgTime(model.CreatedAt),
	}
}

func deviceRelationFromSQL(model sqlc.DeviceRelation) DeviceRelation {
	return DeviceRelation{
		ID:                     model.ID,
		ParentDeviceID:         model.ParentDeviceID,
		ChildDeviceID:          model.ChildDeviceID,
		RelationType:           model.RelationType,
		DataSourceID:           model.DataSourceID,
		ExternalParentDeviceID: model.ExternalParentDeviceID,
		ExternalChildDeviceID:  model.ExternalChildDeviceID,
		Status:                 model.Status,
		SyncedAt:               pgTime(model.SyncedAt),
		CreatedAt:              pgTime(model.CreatedAt),
		UpdatedAt:              pgTime(model.UpdatedAt),
	}
}

func deviceRelationFromUpsertRow(model sqlc.UpsertDeviceRelationRow) DeviceRelation {
	return DeviceRelation{
		ID:                     model.ID,
		ParentDeviceID:         model.ParentDeviceID,
		ChildDeviceID:          model.ChildDeviceID,
		RelationType:           model.RelationType,
		DataSourceID:           model.DataSourceID,
		ExternalParentDeviceID: model.ExternalParentDeviceID,
		ExternalChildDeviceID:  model.ExternalChildDeviceID,
		Status:                 model.Status,
		SyncedAt:               pgTime(model.SyncedAt),
		CreatedAt:              pgTime(model.CreatedAt),
		UpdatedAt:              pgTime(model.UpdatedAt),
	}
}
