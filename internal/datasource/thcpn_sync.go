package datasource

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const defaultTHCPNProductID = "thcpn_standard_station"

type SyncTHCPNStandardStationInput struct {
	DataSourceID      uuid.UUID
	TargetWorkspaceID uuid.UUID
	ProjectID         *uuid.UUID
	SiteID            *uuid.UUID
	ExternalDeviceID  int64
	ProductID         string
	SerialNo          string
	Name              string
	ActorUserID       uuid.UUID
}

type SyncTHCPNGatewayInput struct {
	DataSourceID      uuid.UUID
	TargetWorkspaceID uuid.UUID
	ProjectID         *uuid.UUID
	SiteID            *uuid.UUID
	ExternalGatewayID int64
	AssignNodes       bool
	ProductID         string
	SerialNo          string
	Name              string
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
	ID                 uuid.UUID `json:"id"`
	DeviceID           uuid.UUID `json:"device_id"`
	DataSourceID       uuid.UUID `json:"data_source_id"`
	AdapterCode        string    `json:"adapter_code"`
	ExternalDeviceID   int64     `json:"external_device_id"`
	ExternalSN         *string   `json:"external_sn,omitempty"`
	ExternalUUID       *string   `json:"external_uuid,omitempty"`
	ExternalDeviceType *string   `json:"external_device_type,omitempty"`
	Status             string    `json:"status"`
	SyncedAt           time.Time `json:"synced_at"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
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
	ProductID         string
	SerialNo          string
	Name              string
	ActorUserID       uuid.UUID
}

func (s *Service) SyncTHCPNStandardStation(ctx context.Context, input SyncTHCPNStandardStationInput) (THCPNStandardStationSyncResult, error) {
	if s.db == nil {
		return THCPNStandardStationSyncResult{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	deviceInput := thcpnDeviceSyncInput{
		TargetWorkspaceID: input.TargetWorkspaceID,
		ProjectID:         input.ProjectID,
		SiteID:            input.SiteID,
		ExternalDeviceID:  input.ExternalDeviceID,
		ProductID:         input.ProductID,
		SerialNo:          input.SerialNo,
		Name:              input.Name,
		ActorUserID:       input.ActorUserID,
	}
	if err := validateTHCPNDeviceSyncInput(deviceInput); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if input.TargetWorkspaceID != uuid.Nil {
		if err := validateTHCPNSyncTarget(ctx, s.queries, input.TargetWorkspaceID, input.ProjectID, input.SiteID); err != nil {
			return THCPNStandardStationSyncResult{}, err
		}
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
	if input.TargetWorkspaceID != uuid.Nil {
		if err := validateTHCPNSyncTarget(ctx, s.queries, input.TargetWorkspaceID, input.ProjectID, input.SiteID); err != nil {
			return THCPNGatewaySyncResult{}, err
		}
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
			ActorUserID:      input.ActorUserID,
		}
		if input.AssignNodes {
			nodeInput.TargetWorkspaceID = input.TargetWorkspaceID
			nodeInput.ProjectID = input.ProjectID
			nodeInput.SiteID = input.SiteID
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
		TargetWorkspaceID: input.TargetWorkspaceID,
		ProjectID:         input.ProjectID,
		SiteID:            input.SiteID,
		ExternalDeviceID:  input.ExternalGatewayID,
		ProductID:         input.ProductID,
		SerialNo:          input.SerialNo,
		Name:              input.Name,
		ActorUserID:       input.ActorUserID,
	}
	if err := validateTHCPNDeviceSyncInput(gatewayInput); err != nil {
		return thcpnDeviceSyncInput{}, err
	}
	if input.AssignNodes && input.TargetWorkspaceID == uuid.Nil {
		return thcpnDeviceSyncInput{}, apperr.New(apperr.KindInvalidArgument, "target_workspace_id is required when assign_nodes is true")
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
	streamSpecs, err := buildTHCPNStreamSpecs(input.ExternalDeviceID, externalConfig.Data, externalConfig.Image)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}

	deviceRow, assignmentRow, err := s.upsertTHCPNPlatformDevice(ctx, q, source, input, externalDevice)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	capabilities := capabilitiesForTHCPNStreams(streamSpecs)
	for _, capability := range capabilities {
		if err := addDeviceCapabilityIfMissing(ctx, q, deviceRow.ID, capability); err != nil {
			return THCPNStandardStationSyncResult{}, err
		}
	}

	refRow, err := q.UpsertDeviceSourceRef(ctx, sqlc.UpsertDeviceSourceRefParams{
		DeviceID:           deviceRow.ID,
		DataSourceID:       source.ID,
		AdapterCode:        AdapterTHCPNLegacy,
		ExternalDeviceID:   input.ExternalDeviceID,
		ExternalSn:         externalDevice.SN,
		ExternalUuid:       externalDevice.UUID,
		ExternalDeviceType: externalDevice.DeviceType,
	})
	if err != nil {
		return THCPNStandardStationSyncResult{}, mapWriteError(err, "upsert device source ref")
	}

	snapshotRow, err := q.UpsertDeviceConfigSnapshot(ctx, sqlc.UpsertDeviceConfigSnapshotParams{
		DeviceID:         deviceRow.ID,
		DataSourceID:     source.ID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
		ExternalConfigID: externalConfig.ID,
		Version:          externalConfig.Version,
		DataJson:         []byte(externalConfig.Data),
		ImageJson:        []byte(externalConfig.Image),
		ControlJson:      []byte(externalConfig.Control),
		SourceCreatedAt:  timestamptzFromPtr(externalConfig.CreatedAt),
		SourceUpdatedAt:  timestamptzFromPtr(externalConfig.UpdatedAt),
	})
	if err != nil {
		return THCPNStandardStationSyncResult{}, mapWriteError(err, "upsert device config snapshot")
	}

	streams := make([]SyncedDataStream, 0, len(streamSpecs))
	bindings := make([]DataStreamBinding, 0, len(streamSpecs))
	for _, spec := range streamSpecs {
		streamRow, err := q.UpsertDataStreamFromSync(ctx, sqlc.UpsertDataStreamFromSyncParams{
			DeviceID:  deviceRow.ID,
			Code:      spec.Code,
			Name:      spec.Name,
			Type:      spec.Type,
			Unit:      optionalString(spec.Unit),
			CreatedBy: input.ActorUserID,
		})
		if err != nil {
			return THCPNStandardStationSyncResult{}, mapWriteError(err, "upsert data stream")
		}
		streams = append(streams, syncedDataStreamFromSQL(streamRow))

		binding, err := upsertTHCPNDataStreamBinding(ctx, q, source.ID, streamRow.ID, spec, input.ActorUserID)
		if err != nil {
			return THCPNStandardStationSyncResult{}, err
		}
		bindings = append(bindings, binding)
	}

	return THCPNStandardStationSyncResult{
		Device:         syncedDeviceFromSQL(deviceRow, assignmentRow),
		SourceRef:      deviceSourceRefFromSQL(refRow),
		ConfigSnapshot: deviceConfigSnapshotFromSQL(snapshotRow),
		DataStreams:    streams,
		Bindings:       bindings,
		ExternalDevice: externalDevice.THCPNExternalDeviceMetadata,
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

func (s *Service) upsertTHCPNPlatformDevice(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, input thcpnDeviceSyncInput, external thcpnExternalDevice) (sqlc.Device, *sqlc.DeviceAssignment, error) {
	productID := strings.TrimSpace(input.ProductID)
	if productID == "" {
		productID = defaultTHCPNProductID
	}
	serialNo := strings.TrimSpace(input.SerialNo)
	if serialNo == "" && external.SN != nil {
		serialNo = strings.TrimSpace(*external.SN)
	}
	if serialNo == "" && external.UUID != nil {
		serialNo = strings.TrimSpace(*external.UUID)
	}
	if serialNo == "" {
		serialNo = fmt.Sprintf("thcpn-%d", input.ExternalDeviceID)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = strings.TrimSpace(external.Name)
	}
	if name == "" {
		name = serialNo
	}

	existingRef, err := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
		DataSourceID:     source.ID,
		AdapterCode:      AdapterTHCPNLegacy,
		ExternalDeviceID: input.ExternalDeviceID,
	})
	if err == nil {
		current, err := q.GetDevice(ctx, existingRef.DeviceID)
		if err != nil {
			return sqlc.Device{}, nil, mapNotFoundOrInternal(err, "mapped device not found")
		}
		device, err := q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{
			ID:        current.ID,
			ProductID: optionalString(productID),
			SerialNo:  serialNo,
			Name:      name,
			Status:    current.Status,
		})
		if err != nil {
			return sqlc.Device{}, nil, mapWriteError(err, "update synced device")
		}
		assignment, err := syncAssignmentIfRequested(ctx, q, device.ID, input)
		if err != nil {
			return sqlc.Device{}, nil, err
		}
		return device, assignment, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Device{}, nil, apperr.Wrap(apperr.KindInternal, "lookup device source ref", err)
	}

	device, err := q.CreateDevice(ctx, sqlc.CreateDeviceParams{
		ProductID: optionalString(productID),
		SerialNo:  serialNo,
		Name:      name,
	})
	if err != nil {
		return sqlc.Device{}, nil, mapWriteError(err, "create synced device")
	}
	assignment, err := syncAssignmentIfRequested(ctx, q, device.ID, input)
	if err != nil {
		return sqlc.Device{}, nil, err
	}
	return device, assignment, nil
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
		DeviceID:    deviceID,
		WorkspaceID: input.TargetWorkspaceID,
		ProjectID:   input.ProjectID,
		SiteID:      input.SiteID,
		AssignedBy:  &input.ActorUserID,
	})
	if err != nil {
		return nil, mapWriteError(err, "assign synced device")
	}
	return &assignment, nil
}

func readTHCPNGateNodes(ctx context.Context, db *sql.DB, externalGatewayID int64) ([]int64, error) {
	const query = `
SELECT node_id
FROM gate_node
WHERE gate_id = ?
  AND deleted_at IS NULL
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
  created_at,
  updated_at
FROM devices
WHERE id = ?
  AND deleted_at IS NULL
LIMIT 1`
	var row thcpnExternalDevice
	var iccid, version, status, deviceType, sn, externalUUID, currentDeviceVersion sql.NullString
	var active sql.NullInt64
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
	row.CreatedAt = nullTimePtr(createdAt)
	row.UpdatedAt = nullTimePtr(updatedAt)
	return row, nil
}

func readLatestTHCPNDeviceConfig(ctx context.Context, db *sql.DB, externalDeviceID int64) (thcpnExternalConfig, error) {
	const query = `
SELECT id, device_id, data, image, control, CAST(version AS CHAR), CAST(uuid AS CHAR), is_mg, created_at, updated_at
FROM device_config
WHERE device_id = ?
  AND deleted_at IS NULL
ORDER BY id DESC
LIMIT 1`
	var row thcpnExternalConfig
	var dataRaw, imageRaw, controlRaw sql.NullString
	var version, externalUUID sql.NullString
	var isMG sql.NullInt64
	var createdAt, updatedAt sql.NullTime
	if err := db.QueryRowContext(ctx, query, externalDeviceID).Scan(
		&row.ID,
		&row.DeviceID,
		&dataRaw,
		&imageRaw,
		&controlRaw,
		&version,
		&externalUUID,
		&isMG,
		&createdAt,
		&updatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return thcpnExternalConfig{}, apperr.New(apperr.KindNotFound, "thcpn device config not found")
		}
		return thcpnExternalConfig{}, apperr.Wrap(apperr.KindDataSource, "read thcpn device config", err)
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
	row.Data = dataJSON
	row.Image = imageJSON
	row.Control = controlJSON
	row.Version = nullStringPtr(version)
	row.UUID = nullStringPtr(externalUUID)
	row.IsMG = isMG.Valid && isMG.Int64 != 0
	row.CreatedAt = nullTimePtr(createdAt)
	row.UpdatedAt = nullTimePtr(updatedAt)
	return row, nil
}

func buildTHCPNStreamSpecs(externalDeviceID int64, dataJSON json.RawMessage, imageJSON json.RawMessage) ([]thcpnStreamSpec, error) {
	specs := make([]thcpnStreamSpec, 0)
	usedCodes := map[string]int{}

	dataSpecs, err := buildTHCPNTelemetryStreamSpecs(externalDeviceID, dataJSON, usedCodes)
	if err != nil {
		return nil, err
	}
	specs = append(specs, dataSpecs...)

	imageSpecs, err := buildTHCPNImageStreamSpecs(externalDeviceID, imageJSON, usedCodes)
	if err != nil {
		return nil, err
	}
	specs = append(specs, imageSpecs...)
	return specs, nil
}

func buildTHCPNTelemetryStreamSpecs(externalDeviceID int64, raw json.RawMessage, usedCodes map[string]int) ([]thcpnStreamSpec, error) {
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
			cfg := thcpnTelemetryAdapterConfig(externalDeviceID, key)
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

func buildTHCPNImageStreamSpecs(externalDeviceID int64, raw json.RawMessage, usedCodes map[string]int) ([]thcpnStreamSpec, error) {
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
		cfg := thcpnImageAdapterConfig(externalDeviceID, key)
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

func thcpnTelemetryAdapterConfig(externalDeviceID int64, jsonKey string) json.RawMessage {
	return marshalAdapterConfig(map[string]any{
		"external_device_id": externalDeviceID,
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

func thcpnImageAdapterConfig(externalDeviceID int64, imageKey string) json.RawMessage {
	return marshalAdapterConfig(map[string]any{
		"external_device_id": externalDeviceID,
		"row_type":           "image",
		"image_key":          imageKey,
		"object_key_path":    thcpnJSONValuePath(imageKey),
		"media_type":         "image",
		"table_index":        defaultTHCPNTableIndexField,
		"table_name_field":   defaultTHCPNTableNameField,
		"index_start_field":  defaultTHCPNIndexStartField,
		"index_end_field":    defaultTHCPNIndexEndField,
		"time_field":         defaultTHCPNTimeField,
	})
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
		ID:        model.ID,
		ProductID: model.ProductID,
		SerialNo:  model.SerialNo,
		Name:      model.Name,
		Status:    model.Status,
		CreatedAt: pgTime(model.CreatedAt),
		UpdatedAt: pgTime(model.UpdatedAt),
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
		ID:                 model.ID,
		DeviceID:           model.DeviceID,
		DataSourceID:       model.DataSourceID,
		AdapterCode:        model.AdapterCode,
		ExternalDeviceID:   model.ExternalDeviceID,
		ExternalSN:         model.ExternalSn,
		ExternalUUID:       model.ExternalUuid,
		ExternalDeviceType: model.ExternalDeviceType,
		Status:             model.Status,
		SyncedAt:           pgTime(model.SyncedAt),
		CreatedAt:          pgTime(model.CreatedAt),
		UpdatedAt:          pgTime(model.UpdatedAt),
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
