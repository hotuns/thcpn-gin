package thcpn

import (
	"bytes"
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
	"sort"
	"strconv"
	"strings"
	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
type SyncTHCPNGatewayInput struct {
	DataSourceID      uuid.UUID
	ExternalGatewayID int64
	ActorUserID       uuid.UUID
}
type THCPNStandardStationSyncResult struct {
	Device         platform.SyncedDevice         `json:"device"`
	SourceRef      platform.DeviceSourceRef      `json:"source_ref"`
	ConfigSnapshot platform.DeviceConfigSnapshot `json:"config_snapshot"`
	DataStreams    []platform.SyncedDataStream   `json:"data_streams"`
	Bindings       []platform.DataStreamBinding  `json:"bindings"`
	ExternalDevice THCPNExternalDeviceMetadata   `json:"external_device"`
	Warnings       []platform.QueryWarning       `json:"warnings,omitempty"`
}
type THCPNGatewaySyncResult struct {
	Gateway          THCPNStandardStationSyncResult   `json:"gateway"`
	Nodes            []THCPNStandardStationSyncResult `json:"nodes"`
	Relations        []platform.DeviceRelation        `json:"relations"`
	RemovedRelations []platform.DeviceRelation        `json:"removed_relations,omitempty"`
	Warnings         []platform.QueryWarning          `json:"warnings,omitempty"`
}
type THCPNDeviceSyncFailure struct {
	ExternalDeviceID int64  `json:"external_device_id"`
	Error            string `json:"error"`
}
type THCPNDeviceSyncWarning struct {
	ExternalDeviceID int64 `json:"external_device_id"`
	platform.QueryWarning
}
type THCPNAllDevicesSyncResult struct {
	Warnings       []THCPNDeviceSyncWarning `json:"warnings,omitempty"`
	DataSourceID   uuid.UUID                `json:"data_source_id"`
	Total          int                      `json:"total"`
	Synced         int                      `json:"synced"`
	Created        int                      `json:"created"`
	Updated        int                      `json:"updated"`
	Unconfigured   int                      `json:"unconfigured"`
	Failed         int                      `json:"failed"`
	Relations      int                      `json:"relations"`
	TopologyFailed int                      `json:"topology_failed"`
	Failures       []THCPNDeviceSyncFailure `json:"failures,omitempty"`
}
type thcpnExternalDeviceIndex struct {
	ID         int64
	DeviceType string
}
type thcpnGatewayTopology struct {
	GatewayID int64
	NodeIDs   []int64
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
	ExternalDevice    *thcpnExternalDevice
	ExternalConfig    *thcpnExternalConfig
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
	if s.DB == nil {
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
	unlock, lockErr := s.LockSourceSync(ctx, source.ID.String()+"/thcpn")
	if lockErr != nil {
		return THCPNStandardStationSyncResult{}, lockErr
	}
	defer unlock()
	runtime := s.Runtime
	deviceDB, err := runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	deviceInput, err = prepareTHCPNSync(ctx, deviceDB, deviceInput)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn sync transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.Queries.WithTx(tx)

	result, err := s.syncTHCPNDevice(ctx, q, source, deviceInput)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn sync transaction", err)
	}
	committed = true
	result.Warnings = s.syncTHCPNAvatarsAfterCommit(ctx, result.Device.ID, result.ExternalDevice.AvatarURLs)

	return result, nil
}
func (s *Service) SyncAllTHCPNDevices(ctx context.Context, input SyncAllTHCPNDevicesInput) (THCPNAllDevicesSyncResult, error) {
	if input.ActorUserID == uuid.Nil {
		return THCPNAllDevicesSyncResult{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if s.DB == nil {
		return THCPNAllDevicesSyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	unlock, lockErr := s.LockSourceSync(ctx, source.ID.String()+"/thcpn")
	if lockErr != nil {
		return THCPNAllDevicesSyncResult{}, lockErr
	}
	defer unlock()
	deviceDB, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}

	externalDevices, err := readAllTHCPNExternalDevices(ctx, deviceDB)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	topology, err := readAllTHCPNGatewayTopology(ctx, deviceDB)
	if err != nil {
		return THCPNAllDevicesSyncResult{}, err
	}
	gatewayIDs, nodeIDs := indexTHCPNTopology(topology)
	result := THCPNAllDevicesSyncResult{
		DataSourceID: input.DataSourceID,
		Total:        len(externalDevices),
		Failures:     make([]THCPNDeviceSyncFailure, 0),
	}
	for _, externalDevice := range externalDevices {
		platform.ReportSyncProgress(ctx, result)
		externalDeviceID := externalDevice.ID
		if err := ctx.Err(); err != nil {
			return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "thcpn full sync canceled", err)
		}
		_, lookupErr := s.Queries.GetNumericDeviceSourceRefByExternal(ctx, sqlc.GetNumericDeviceSourceRefByExternalParams{
			DataSourceID: input.DataSourceID, AdapterCode: platform.AdapterTHCPNLegacy, ExternalDeviceID: externalDeviceID,
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
			metadata, readErr := readTHCPNExternalDevice(ctx, deviceDB, externalDeviceID)
			if readErr != nil {
				result.Failed++
				result.Failures = append(result.Failures, THCPNDeviceSyncFailure{ExternalDeviceID: externalDeviceID, Error: apperr.MessageOf(readErr)})
				continue
			}

			tx, txErr := s.DB.BeginTx(ctx, pgx.TxOptions{})
			if txErr != nil {
				return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn metadata sync transaction", txErr)
			}
			q := s.Queries.WithTx(tx)
			metadataDevice, _, metadataErr := s.syncTHCPNDeviceMetadata(ctx, q, source, metadata, externalDeviceID, syncedTHCPNDeviceType(externalDevice, gatewayIDs, nodeIDs), input.ActorUserID)
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
			result.addAvatarWarnings(externalDeviceID, s.syncTHCPNAvatarsAfterCommit(ctx, metadataDevice.ID, metadata.AvatarURLs))
			result.Synced++
			result.Unconfigured++
			if existed {
				result.Updated++
			} else {
				result.Created++
			}
			continue
		}

		snapshot, snapshotErr := prepareTHCPNSync(ctx, deviceDB, thcpnDeviceSyncInput{ExternalDeviceID: externalDeviceID, DeviceType: syncedTHCPNDeviceType(externalDevice, gatewayIDs, nodeIDs), ActorUserID: input.ActorUserID})
		if snapshotErr != nil {
			result.Failed++
			result.Failures = append(result.Failures, THCPNDeviceSyncFailure{ExternalDeviceID: externalDeviceID, Error: apperr.MessageOf(snapshotErr)})
			continue
		}

		tx, txErr := s.DB.BeginTx(ctx, pgx.TxOptions{})
		if txErr != nil {
			return THCPNAllDevicesSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn full sync transaction", txErr)
		}
		q := s.Queries.WithTx(tx)
		synced, syncErr := s.syncTHCPNDevice(ctx, q, source, snapshot)
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
		result.addAvatarWarnings(externalDeviceID, s.syncTHCPNAvatarsAfterCommit(ctx, synced.Device.ID, synced.ExternalDevice.AvatarURLs))
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
	return result, nil
}
func (r *THCPNAllDevicesSyncResult) addAvatarWarnings(externalID int64, warnings []platform.QueryWarning) {
	for _, warning := range warnings {
		r.Warnings = append(r.Warnings, THCPNDeviceSyncWarning{ExternalDeviceID: externalID, QueryWarning: warning})
	}
}
func (s *Service) syncTHCPNDeviceMetadata(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, externalDevice thcpnExternalDevice, externalDeviceID int64, deviceType string, actorUserID uuid.UUID) (sqlc.Device, bool, error) {
	deviceRow, _, created, err := s.upsertTHCPNPlatformDevice(ctx, q, source, thcpnDeviceSyncInput{
		ExternalDeviceID: externalDeviceID,
		DeviceType:       deviceType,
		ActorUserID:      actorUserID,
	}, externalDevice)
	if err != nil {
		return sqlc.Device{}, false, err
	}
	if _, err := q.UpsertNumericDeviceSourceRef(ctx, sqlc.UpsertNumericDeviceSourceRefParams{
		DeviceID:         deviceRow.ID,
		DataSourceID:     source.ID,
		AdapterCode:      platform.AdapterTHCPNLegacy,
		ExternalDeviceID: externalDeviceID,
	}); err != nil {
		return sqlc.Device{}, false, platform.MapWriteError(err, "upsert device source ref")
	}
	if err := platform.AddDeviceCapabilityIfMissing(ctx, q, deviceRow.ID, "firmware_update"); err != nil {
		return sqlc.Device{}, false, err
	}
	return deviceRow, created, nil
}
func (s *Service) SyncTHCPNGateway(ctx context.Context, input SyncTHCPNGatewayInput) (THCPNGatewaySyncResult, error) {
	gatewayInput, err := validateTHCPNGatewaySyncInput(input)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	if s.DB == nil {
		return THCPNGatewaySyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	unlock, lockErr := s.LockSourceSync(ctx, source.ID.String()+"/thcpn")
	if lockErr != nil {
		return THCPNGatewaySyncResult{}, lockErr
	}
	defer unlock()
	runtime := s.Runtime
	deviceDB, err := runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}

	gateNodes, err := readTHCPNGateNodes(ctx, deviceDB, input.ExternalGatewayID)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	gatewayInput, err = prepareTHCPNSync(ctx, deviceDB, gatewayInput)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	nodeSnapshots := map[int64]thcpnDeviceSyncInput{}
	for _, nodeID := range gateNodes {
		snapshot, err := prepareTHCPNSync(ctx, deviceDB, thcpnDeviceSyncInput{ExternalDeviceID: nodeID, DeviceType: "gateway_node", ActorUserID: input.ActorUserID})
		if err != nil {
			return THCPNGatewaySyncResult{}, err
		}
		nodeSnapshots[nodeID] = snapshot
	}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNGatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn gateway sync transaction", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	q := s.Queries.WithTx(tx)

	gateway, err := s.syncTHCPNDevice(ctx, q, source, gatewayInput)
	if err != nil {
		return THCPNGatewaySyncResult{}, err
	}
	nodes := make([]THCPNStandardStationSyncResult, 0, len(gateNodes))
	relations := make([]platform.DeviceRelation, 0, len(gateNodes))
	activeChildIDs := make([]int64, 0, len(gateNodes))
	for _, nodeID := range gateNodes {
		nodeInput := nodeSnapshots[nodeID]
		node, err := s.syncTHCPNDevice(ctx, q, source, nodeInput)
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
			return THCPNGatewaySyncResult{}, platform.MapWriteError(err, "upsert device relation")
		}
		activeChildIDs = append(activeChildIDs, nodeID)
		nodes = append(nodes, node)
		relations = append(relations, platform.DeviceRelationFromUpsertRow(relation))
	}
	removed, err := q.MarkMissingDeviceRelationsRemoved(ctx, sqlc.MarkMissingDeviceRelationsRemovedParams{
		DataSourceID:           source.ID,
		ExternalParentDeviceID: input.ExternalGatewayID,
		ActiveChildIds:         activeChildIDs,
	})
	if err != nil {
		return THCPNGatewaySyncResult{}, platform.MapWriteError(err, "mark missing device relations removed")
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNGatewaySyncResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn gateway sync transaction", err)
	}
	committed = true

	gateway.Warnings = s.syncTHCPNAvatarsAfterCommit(ctx, gateway.Device.ID, gateway.ExternalDevice.AvatarURLs)
	for i := range nodes {
		nodes[i].Warnings = s.syncTHCPNAvatarsAfterCommit(ctx, nodes[i].Device.ID, nodes[i].ExternalDevice.AvatarURLs)
	}
	removedRelations := make([]platform.DeviceRelation, 0, len(removed))
	for _, relation := range removed {
		removedRelations = append(removedRelations, platform.DeviceRelationFromSQL(relation))
	}
	result := THCPNGatewaySyncResult{
		Gateway:          gateway,
		Nodes:            nodes,
		Relations:        relations,
		RemovedRelations: removedRelations,
	}
	if len(nodes) == 0 {
		result.Warnings = append(result.Warnings, platform.QueryWarning{
			Code:    "thcpn_gateway_without_nodes",
			Message: "未在 gate_node 中发现该网关的 active 节点",
		})
	}
	return result, nil
}
func (s *Service) GetDeviceConfig(ctx context.Context, deviceID uuid.UUID) (platform.DeviceConfigDetail, error) {
	if s.DB == nil {
		return platform.DeviceConfigDetail{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	if deviceID == uuid.Nil {
		return platform.DeviceConfigDetail{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	ref, err := s.Queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, deviceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, platform.MapNotFoundOrInternal(err, "thcpn device source ref not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}

	runtime := s.Runtime
	deviceDB, err := runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}

	latestConfig, err := readLatestTHCPNDeviceConfig(ctx, deviceDB, ref.ExternalDeviceID)
	if err != nil {
		return platform.DeviceConfigDetail{}, err
	}
	var latestSnapshot *platform.DeviceConfigSnapshot
	if snapshot, err := s.Queries.GetLatestDeviceConfigSnapshotByDevice(ctx, deviceID); err == nil {
		converted := platform.DeviceConfigSnapshotFromSQL(snapshot)
		latestSnapshot = &converted
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return platform.DeviceConfigDetail{}, apperr.Wrap(apperr.KindInternal, "get latest device config snapshot", err)
	}

	return platform.DeviceConfigDetail{
		DeviceID:         deviceID,
		DataSourceID:     ref.DataSourceID,
		ExternalDeviceID: ref.ExternalDeviceID,
		LatestConfig:     thcpnDeviceConfigFromExternal(latestConfig),
		LatestSnapshot:   latestSnapshot,
	}, nil
}
func (s *Service) UpdateDeviceConfig(ctx context.Context, input platform.UpdateDeviceConfigInput) (response platform.UpdateDeviceConfigResult, err error) {
	if s.DB == nil {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	if input.DeviceID == uuid.Nil {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "device id is required")
	}
	if input.ActorUserID == uuid.Nil {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "actor user id is required")
	}
	if input.ExpectedConfigID <= 0 {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindInvalidArgument, "expected_config_id is required")
	}
	dataJSON, err := platform.NormalizeConfigArrayJSON(input.DataJSON, "data_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	imageJSON, err := platform.NormalizeConfigArrayJSON(input.ImageJSON, "image_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	controlJSON, err := platform.NormalizeConfigObjectJSON(input.ControlJSON, "control_json")
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}

	ref, err := s.Queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, input.DeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, platform.MapNotFoundOrInternal(err, "thcpn device source ref not found")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}

	unlock, lockErr := s.LockSourceSync(ctx, source.ID.String()+"/thcpn")
	if lockErr != nil {
		return platform.UpdateDeviceConfigResult{}, lockErr
	}
	defer unlock()
	runtime := s.Runtime
	deviceDB, err := runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}

	mysqlTx, err := deviceDB.BeginTx(ctx, nil)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, apperr.Wrap(apperr.KindDataSource, "begin thcpn config transaction", err)
	}
	mysqlCommitted := false
	defer func() {
		if !mysqlCommitted {
			_ = mysqlTx.Rollback()
		}
	}()
	previous, err := readLatestTHCPNDeviceConfigForUpdate(ctx, mysqlTx, ref.ExternalDeviceID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	if previous.ID != input.ExpectedConfigID {
		return platform.UpdateDeviceConfigResult{}, apperr.New(apperr.KindConflict, "device config has changed; reload and try again")
	}

	operationID, err := s.BeginSourceOperation(ctx, source.ID, &input.DeviceID, "config_update", "running", map[string]any{"expected_config_id": input.ExpectedConfigID, "data": dataJSON, "image": imageJSON, "control": controlJSON}, input.ActorUserID)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	state := &platform.ConfigWriteState{OperationID: operationID, Source: "pending", Platform: "pending", Device: "unknown"}
	var acceptedConfig platform.DeviceConfig
	defer func() {
		operationErr := err
		status := "completed"
		if err != nil {
			if state.Source == "accepted" {
				status = "partial"
				state.Platform = "failed"
				response = platform.UpdateDeviceConfigResult{DeviceID: input.DeviceID, DataSourceID: source.ID, ExternalDeviceID: ref.ExternalDeviceID, Config: acceptedConfig, Warnings: []platform.QueryWarning{{Code: "platform_sync_failed", Message: "源配置已保存，但平台同步失败；请重新同步配置，不要重复提交。"}}}
				err = nil
			} else if state.Source == "unknown" {
				status = "unknown"
				err = apperr.Wrap(apperr.KindDataSource, "配置写入结果未知，请核对源端配置；操作 "+operationID.String(), err)
			} else {
				status = "failed"
				state.Source = "failed"
			}
		}
		response.WriteState = state
		if recordErr := s.FinishSourceOperation(operationID, status, state, operationErr); recordErr != nil && err == nil {
			response.Warnings = append(response.Warnings, platform.QueryWarning{Code: "operation_record_failed", Message: "操作结果记录未更新，请重新核对配置状态。"})
		}
	}()
	auditSummary := platform.SummarizeConfigChange(previous.ID, previous.Data, previous.Image, previous.Control, dataJSON, imageJSON, controlJSON)
	inserted, err := insertTHCPNDeviceConfig(ctx, mysqlTx, previous, dataJSON, imageJSON, controlJSON)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	state.Source = "unknown"
	if err := mysqlTx.Commit(); err != nil {
		return platform.UpdateDeviceConfigResult{}, apperr.Wrap(apperr.KindDataSource, "commit thcpn config transaction", err)
	}
	mysqlCommitted = true
	state.Source = "accepted"
	acceptedConfig = thcpnDeviceConfigFromExternal(inserted)

	pgTx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, apperr.Wrap(apperr.KindInternal, "begin thcpn config apply transaction", err)
	}
	pgCommitted := false
	defer func() {
		if !pgCommitted {
			_ = pgTx.Rollback(ctx)
		}
	}()
	q := s.Queries.WithTx(pgTx)
	applied, err := applyTHCPNConfigToPlatform(ctx, q, source.ID, input.DeviceID, ref.ExternalDeviceID, inserted, input.ActorUserID, true)
	if err != nil {
		return platform.UpdateDeviceConfigResult{}, err
	}
	for _, capability := range capabilitiesForSyncedTHCPNStreams(applied.Streams) {
		if err := platform.AddDeviceCapabilityIfMissing(ctx, q, input.DeviceID, capability); err != nil {
			return platform.UpdateDeviceConfigResult{}, err
		}
	}
	if err := pgTx.Commit(ctx); err != nil {
		return platform.UpdateDeviceConfigResult{}, apperr.Wrap(apperr.KindInternal, "commit thcpn config apply transaction", err)
	}
	pgCommitted = true
	state.Platform = "synced"

	return platform.UpdateDeviceConfigResult{
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

func (s *Service) loadTHCPNSyncDataSource(ctx context.Context, dataSourceID uuid.UUID) (sqlc.DataSource, error) {
	return s.LoadMySQLDataSourceForFamily(ctx, dataSourceID, platform.SourceFamilyTHCPN)
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
func prepareTHCPNSync(ctx context.Context, db *sql.DB, input thcpnDeviceSyncInput) (thcpnDeviceSyncInput, error) {
	external, err := readTHCPNExternalDevice(ctx, db, input.ExternalDeviceID)
	if err != nil {
		return input, err
	}
	config, err := readLatestTHCPNDeviceConfig(ctx, db, input.ExternalDeviceID)
	if err != nil {
		return input, err
	}
	if _, err := buildTHCPNStreamSpecsForDevice(input.ExternalDeviceID, input.DeviceType, config.Data, config.Image); err != nil {
		return input, err
	}
	input.ExternalDevice = &external
	input.ExternalConfig = &config
	return input, nil
}
func (s *Service) syncTHCPNDevice(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, input thcpnDeviceSyncInput) (THCPNStandardStationSyncResult, error) {
	if input.ExternalDevice == nil || input.ExternalConfig == nil {
		return THCPNStandardStationSyncResult{}, apperr.New(apperr.KindInternal, "source snapshot is required")
	}
	externalDevice, externalConfig := *input.ExternalDevice, *input.ExternalConfig

	deviceRow, assignmentRow, created, err := s.upsertTHCPNPlatformDevice(ctx, q, source, input, externalDevice)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if created {
		streamSpecs, err := buildTHCPNStreamSpecsForDevice(input.ExternalDeviceID, input.DeviceType, externalConfig.Data, externalConfig.Image)
		if err != nil {
			return THCPNStandardStationSyncResult{}, err
		}
		capabilities := capabilitiesForTHCPNStreams(streamSpecs)
		for _, capability := range capabilities {
			if err := platform.AddDeviceCapabilityIfMissing(ctx, q, deviceRow.ID, capability); err != nil {
				return THCPNStandardStationSyncResult{}, err
			}
		}
	}

	refRow, err := q.UpsertNumericDeviceSourceRef(ctx, sqlc.UpsertNumericDeviceSourceRefParams{
		DeviceID:         deviceRow.ID,
		DataSourceID:     source.ID,
		AdapterCode:      platform.AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
	})
	if err != nil {
		return THCPNStandardStationSyncResult{}, platform.MapWriteError(err, "upsert device source ref")
	}
	if err := platform.AddDeviceCapabilityIfMissing(ctx, q, deviceRow.ID, "firmware_update"); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	applied, err := applyTHCPNConfigToPlatform(ctx, q, source.ID, deviceRow.ID, input.ExternalDeviceID, externalConfig, input.ActorUserID, true)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	return THCPNStandardStationSyncResult{
		Device:         platform.SyncedDeviceFromSQL(deviceRow, assignmentRow),
		SourceRef:      platform.DeviceSourceRefFromSQL(refRow),
		ConfigSnapshot: applied.Snapshot,
		DataStreams:    applied.Streams,
		Bindings:       applied.Bindings,
		ExternalDevice: externalDevice.THCPNExternalDeviceMetadata,
	}, nil
}

type appliedTHCPNConfig struct {
	Snapshot         platform.DeviceConfigSnapshot
	Streams          []platform.SyncedDataStream
	Bindings         []platform.DataStreamBinding
	DisabledStreams  []platform.SyncedDataStream
	DisabledBindings []platform.DataStreamBinding
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
		return appliedTHCPNConfig{}, platform.MapNotFoundOrInternal(err, "device not found")
	}
	streamSpecs, err := buildTHCPNStreamSpecsForDevice(externalDeviceID, device.DeviceType, externalConfig.Data, externalConfig.Image)
	if err != nil {
		return appliedTHCPNConfig{}, err
	}

	snapshotRow, err := q.UpsertDeviceConfigSnapshot(ctx, sqlc.UpsertDeviceConfigSnapshotParams{
		DeviceID:         deviceID,
		DataSourceID:     dataSourceID,
		AdapterCode:      platform.AdapterTHCPNLegacy,
		ExternalDeviceID: externalDeviceID,
		ExternalConfigID: externalConfig.ID,
		Version:          externalConfig.Version,
		DataJson:         []byte(externalConfig.Data),
		ImageJson:        []byte(externalConfig.Image),
		ControlJson:      []byte(externalConfig.Control),
		SourceCreatedAt:  platform.TimestamptzFromPtr(externalConfig.CreatedAt),
		SourceUpdatedAt:  platform.TimestamptzFromPtr(externalConfig.UpdatedAt),
	})
	if err != nil {
		return appliedTHCPNConfig{}, platform.MapWriteError(err, "upsert device config snapshot")
	}

	streams := make([]platform.SyncedDataStream, 0, len(streamSpecs))
	bindings := make([]platform.DataStreamBinding, 0, len(streamSpecs))
	activeCodes := make([]string, 0, len(streamSpecs))
	for _, spec := range streamSpecs {
		streamRow, err := q.UpsertDataStreamFromSync(ctx, sqlc.UpsertDataStreamFromSyncParams{
			DeviceID:  deviceID,
			Code:      spec.Code,
			Name:      spec.Name,
			Type:      spec.Type,
			Unit:      platform.OptionalString(spec.Unit),
			CreatedBy: actorUserID,
		})
		if err != nil {
			return appliedTHCPNConfig{}, platform.MapWriteError(err, "upsert data stream")
		}
		activeCodes = append(activeCodes, streamRow.Code)
		streams = append(streams, platform.SyncedDataStreamFromSQL(streamRow))

		binding, err := upsertTHCPNDataStreamBinding(ctx, q, dataSourceID, streamRow.ID, spec, actorUserID)
		if err != nil {
			return appliedTHCPNConfig{}, err
		}
		bindings = append(bindings, binding)
	}

	var disabledBindings []platform.DataStreamBinding
	var disabledStreams []platform.SyncedDataStream
	if disableMissing {
		disabledStreamRows, err := q.DisableMissingTHCPNDataStreams(ctx, sqlc.DisableMissingTHCPNDataStreamsParams{
			DeviceID:         deviceID,
			DataSourceID:     dataSourceID,
			ExternalDeviceID: externalDeviceID,
			ActiveCodes:      activeCodes,
		})
		if err != nil {
			return appliedTHCPNConfig{}, platform.MapWriteError(err, "disable missing thcpn data streams")
		}
		disabledStreams = make([]platform.SyncedDataStream, 0, len(disabledStreamRows))
		for _, row := range disabledStreamRows {
			disabledStreams = append(disabledStreams, platform.SyncedDataStreamFromSQL(row))
		}

		disabledBindingRows, err := q.DisableMissingTHCPNDataStreamBindings(ctx, sqlc.DisableMissingTHCPNDataStreamBindingsParams{
			DeviceID:         deviceID,
			DataSourceID:     dataSourceID,
			ExternalDeviceID: externalDeviceID,
			ActiveCodes:      activeCodes,
		})
		if err != nil {
			return appliedTHCPNConfig{}, platform.MapWriteError(err, "disable missing thcpn data stream bindings")
		}
		disabledBindings = make([]platform.DataStreamBinding, 0, len(disabledBindingRows))
		for _, row := range disabledBindingRows {
			disabledBindings = append(disabledBindings, platform.BindingFromSQL(row))
		}
	}

	return appliedTHCPNConfig{
		Snapshot:         platform.DeviceConfigSnapshotFromSQL(snapshotRow),
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
		return platform.MapNotFoundOrInternal(err, "target workspace not found")
	}
	if projectID != nil {
		project, err := q.GetProject(ctx, *projectID)
		if err != nil {
			return platform.MapNotFoundOrInternal(err, "target project not found")
		}
		if project.WorkspaceID != workspaceID {
			return apperr.New(apperr.KindInvalidArgument, "project_id does not belong to target workspace")
		}
	}
	if siteID != nil {
		site, err := q.GetSite(ctx, *siteID)
		if err != nil {
			return platform.MapNotFoundOrInternal(err, "target site not found")
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

	existingRef, err := q.GetNumericDeviceSourceRefByExternal(ctx, sqlc.GetNumericDeviceSourceRefByExternalParams{
		DataSourceID:     source.ID,
		AdapterCode:      platform.AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
	})
	if err == nil {
		current, err := q.GetDevice(ctx, existingRef.DeviceID)
		if err != nil {
			return sqlc.Device{}, nil, false, platform.MapNotFoundOrInternal(err, "mapped device not found")
		}
		device, err := q.UpdateSyncedDevice(ctx, sqlc.UpdateSyncedDeviceParams{
			ID:         current.ID,
			ProductID:  platform.OptionalString(productID),
			SourceName: name,
			Status:     current.Status,
		})
		if err != nil {
			return sqlc.Device{}, nil, false, platform.MapWriteError(err, "update synced device")
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
		ProductID: platform.OptionalString(productID),
		Name:      name,
	})
	if err != nil {
		return sqlc.Device{}, nil, false, platform.MapWriteError(err, "create synced device")
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
		return sqlc.Device{}, platform.MapWriteError(err, "update synced device type")
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
		return nil, platform.MapNotFoundOrInternal(err, "active device assignment not found")
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
			return nil, platform.MapWriteError(err, "update synced device assignment")
		}
		return &assignment, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, platform.MapNotFoundOrInternal(err, "active device assignment not found")
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
		return nil, platform.MapWriteError(err, "assign synced device")
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
	row.ICCID = platform.NullStringPtr(iccid)
	row.Version = platform.NullStringPtr(version)
	row.Status = platform.NullStringPtr(status)
	row.DeviceType = platform.NullStringPtr(deviceType)
	row.Active = platform.NullInt64Ptr(active)
	row.SN = platform.NullStringPtr(sn)
	row.UUID = platform.NullStringPtr(externalUUID)
	row.CurrentDeviceVersion = platform.NullStringPtr(currentDeviceVersion)
	row.Latitude = parseSourceCoordinate(latitude, -90, 90)
	row.Longitude = parseSourceCoordinate(longitude, -180, 180)
	if row.Latitude != nil && row.Longitude != nil && *row.Latitude == 0 && *row.Longitude == 0 {
		row.Latitude, row.Longitude = nil, nil
	}
	row.AltitudeM = parseSourceNumber(altitude)
	if avatar.Valid && strings.TrimSpace(avatar.String) != "" {
		_ = json.Unmarshal([]byte(avatar.String), &row.AvatarURLs)
	}
	row.CreatedAt = platform.NullTimePtr(createdAt)
	row.UpdatedAt = platform.NullTimePtr(updatedAt)
	return row, nil
}

// Avatars are optional enrichment. A separate transaction prevents HTTP or image
// storage failures from rolling back device/config/stream synchronization. Missing
// URLs are retried on the next sync; existing URL hashes keep retries idempotent.
func (s *Service) syncTHCPNAvatarsAfterCommit(ctx context.Context, deviceID uuid.UUID, urls []string) []platform.QueryWarning {
	if len(urls) == 0 {
		return nil
	}
	warning := func() []platform.QueryWarning {
		return []platform.QueryWarning{{Code: "thcpn_avatar_sync_failed", Message: "设备已同步，头像保存失败；下次同步将重试", Count: 1}}
	}
	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return warning()
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	warnings, err := s.syncTHCPNDeviceAvatars(ctx, s.Queries.WithTx(tx), deviceID, urls)
	if err != nil {
		return warning()
	}
	if err = tx.Commit(ctx); err != nil {
		return warning()
	}
	return warnings
}
func downloadTHCPNAvatar(ctx context.Context, imageURL string) ([]byte, string, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, "", "", apperr.New(apperr.KindDataSource, "头像地址无效；下次同步将重试")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, "", "", apperr.New(apperr.KindDataSource, "头像下载失败；下次同步将重试")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 10*1024*1024+1))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 || len(data) == 0 || len(data) > 10<<20 {
		return nil, "", "", apperr.New(apperr.KindDataSource, "头像下载内容无效；下次同步将重试")
	}
	contentType := http.DetectContentType(data)
	extension := map[string]string{"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[contentType]
	if extension == "" {
		return nil, "", "", apperr.New(apperr.KindDataSource, "头像格式不支持；下次同步将重试")
	}
	return data, contentType, extension, nil
}
func (s *Service) syncTHCPNDeviceAvatars(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, avatarURLs []string) ([]platform.QueryWarning, error) {
	var warnings []platform.QueryWarning
	if len(avatarURLs) == 0 {
		return nil, nil
	}
	existing, err := q.ListDeviceProfileImages(ctx, deviceID)
	if err != nil {
		return warnings, apperr.Wrap(apperr.KindInternal, "list synced device images", err)
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
		data, contentType, extension, err := downloadTHCPNAvatar(ctx, imageURL)
		if err != nil {
			warnings = append(warnings, platform.QueryWarning{Code: "thcpn_avatar_sync_failed", Message: apperr.MessageOf(err), Count: 1})
			continue
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
			return warnings, apperr.Wrap(apperr.KindInternal, "create synced device image", err)
		}
		existing = append(existing, sqlc.DeviceProfileImage{ObjectKey: objectKey})
		existingKeys[objectKey] = struct{}{}
		remaining--
	}
	return warnings, nil
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
		tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
		if err != nil {
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: apperr.MessageOf(err)})
			continue
		}
		q := s.Queries.WithTx(tx)
		parent, err := q.GetNumericDeviceSourceRefByExternal(ctx, sqlc.GetNumericDeviceSourceRefByExternalParams{
			DataSourceID: dataSourceID, AdapterCode: platform.AdapterTHCPNLegacy, ExternalDeviceID: item.GatewayID,
		})
		if err != nil {
			_ = tx.Rollback(ctx)
			failures = append(failures, THCPNDeviceSyncFailure{ExternalDeviceID: item.GatewayID, Error: "gateway was not synchronized"})
			continue
		}
		complete := true
		for _, nodeID := range item.NodeIDs {
			child, err := q.GetNumericDeviceSourceRefByExternal(ctx, sqlc.GetNumericDeviceSourceRefByExternalParams{
				DataSourceID: dataSourceID, AdapterCode: platform.AdapterTHCPNLegacy, ExternalDeviceID: nodeID,
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
	dataJSON, err := platform.NormalizeSourceJSON(dataRaw, []byte("[]"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.data")
	}
	imageJSON, err := platform.NormalizeSourceJSON(imageRaw, []byte("[]"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.image")
	}
	controlJSON, err := platform.NormalizeSourceJSON(controlRaw, []byte("{}"))
	if err != nil {
		return thcpnExternalConfig{}, apperr.New(apperr.KindDataSource, "invalid thcpn device_config.control")
	}
	result.Data = dataJSON
	result.Image = imageJSON
	result.Control = controlJSON
	result.Version = platform.NullStringPtr(version)
	result.UUID = platform.NullStringPtr(externalUUID)
	result.IsMG = isMG.Valid && isMG.Int64 != 0
	result.CreatedAt = platform.NullTimePtr(createdAt)
	result.UpdatedAt = platform.NullTimePtr(updatedAt)
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
		string(controlJSON), platform.NullableStringArg(previous.Version), platform.NullableStringArg(previous.UUID), platform.BoolInt(previous.IsMG),
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
	if bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
		return buildTHCPNLegacyStreamSpecs(externalDeviceID, shardStrategy, raw, usedCodes)
	}

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

// Legacy station configs are dictionaries of metrics; image metrics share
// device_config.data with telemetry. Keep native JSON intact in the snapshot.
func buildTHCPNLegacyStreamSpecs(externalDeviceID int64, shardStrategy string, raw json.RawMessage, usedCodes map[string]int) ([]thcpnStreamSpec, error) {
	var metrics map[string]struct {
		Desc string `json:"desc"`
		Type string `json:"type"`
		Unit string `json:"unit"`
	}
	if err := json.Unmarshal(raw, &metrics); err != nil {
		return nil, apperr.New(apperr.KindDataSource, "parse thcpn legacy device_config.data")
	}
	keys := make([]string, 0, len(metrics))
	for key := range metrics {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	specs := make([]thcpnStreamSpec, 0, len(keys))
	for _, rawKey := range keys {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			return nil, apperr.New(apperr.KindDataSource, "thcpn legacy metric key is empty")
		}
		metric := metrics[rawKey]
		spec := thcpnStreamSpec{Code: nextTHCPNStreamCode(key, usedCodes), Name: platform.FirstNonEmpty(metric.Desc, key), Type: "telemetry", Unit: strings.TrimSpace(metric.Unit), JSONKey: key, PayloadType: "columns", AdapterConfig: thcpnTelemetryAdapterConfig(externalDeviceID, shardStrategy, key)}
		if metric.Type == "image" {
			spec.Type = "image"
			spec.PayloadType = "media"
			spec.Unit = ""
			spec.AdapterConfig = thcpnImageAdapterConfig(externalDeviceID, shardStrategy, key)
		}
		specs = append(specs, spec)
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
		name := platform.FirstNonEmpty(image.Name, image.Dest, image.Desc, key)
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
	return platform.MarshalAdapterConfig(map[string]any{
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
	return platform.MarshalAdapterConfig(map[string]any{
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
func upsertTHCPNDataStreamBinding(ctx context.Context, q *sqlc.Queries, sourceID uuid.UUID, dataStreamID uuid.UUID, spec thcpnStreamSpec, actorUserID uuid.UUID) (platform.DataStreamBinding, error) {
	input := platform.CreateDataStreamBindingInput{
		DataStreamID:      dataStreamID,
		DataSourceID:      sourceID,
		AdapterCode:       platform.AdapterTHCPNLegacy,
		PayloadType:       spec.PayloadType,
		AdapterConfigJSON: spec.AdapterConfig,
		ActorUserID:       actorUserID,
	}
	normalized, err := platform.NormalizeBinding(input, "active", BindingDefinition())
	if err != nil {
		return platform.DataStreamBinding{}, err
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
			return platform.DataStreamBinding{}, platform.MapWriteError(err, "update thcpn data stream binding")
		}
		return platform.BindingFromSQL(updated), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return platform.DataStreamBinding{}, apperr.Wrap(apperr.KindInternal, "lookup active data stream binding", err)
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
		return platform.DataStreamBinding{}, platform.MapWriteError(err, "create thcpn data stream binding")
	}
	return platform.BindingFromSQL(created), nil
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
func thcpnDeviceConfigFromExternal(config thcpnExternalConfig) platform.DeviceConfig {
	return platform.DeviceConfig{
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
func capabilitiesForSyncedTHCPNStreams(streams []platform.SyncedDataStream) []string {
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
