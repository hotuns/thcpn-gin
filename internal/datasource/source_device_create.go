package datasource

import (
	"context"
	"crypto/md5"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const (
	createdSourceDeviceTHCPNStandard = "thcpn_standard"
	createdSourceDeviceTHCPNGateway  = "thcpn_gateway"
	createdSourceDeviceTHCPNNode     = "thcpn_node"
	createdSourceDeviceCarbon        = "carbon"
)

type CreateSourceDeviceInput struct {
	DataSourceID uuid.UUID
	SourceKind   string
	Name         string
	ICCID        string
	Version      string
	NodesCount   *int64
	ActorUserID  uuid.UUID
}

type CreatedSourceDevice struct {
	DataSourceID     uuid.UUID  `json:"data_source_id"`
	SourceDeviceID   int64      `json:"source_device_id"`
	SN               string     `json:"sn"`
	SourceKind       string     `json:"source_kind"`
	PlatformDeviceID *uuid.UUID `json:"platform_device_id,omitempty"`
	SyncError        string     `json:"sync_error,omitempty"`
}

func createdSourceDeviceSN(prefix string, id int64) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(fmt.Sprintf("%s%d.Sonic513", prefix, id))))
}

func (s *Service) CreateSourceDevice(ctx context.Context, input CreateSourceDeviceInput) (CreatedSourceDevice, error) {
	if input.DataSourceID == uuid.Nil || input.ActorUserID == uuid.Nil {
		return CreatedSourceDevice{}, apperr.New(apperr.KindInvalidArgument, "data source and actor are required")
	}
	if s.db == nil {
		return CreatedSourceDevice{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	family, err := sourceFamilyForCreatedDeviceKind(input.SourceKind)
	if err != nil {
		return CreatedSourceDevice{}, err
	}
	source, err := s.loadMySQLDataSourceForFamily(ctx, input.DataSourceID, family)
	if err != nil {
		return CreatedSourceDevice{}, err
	}
	result := CreatedSourceDevice{DataSourceID: input.DataSourceID, SourceKind: input.SourceKind}
	switch input.SourceKind {
	case createdSourceDeviceTHCPNStandard, createdSourceDeviceTHCPNGateway, createdSourceDeviceTHCPNNode:
		id, sn, err := createTHCPNSourceDevice(ctx, source, input)
		if err != nil {
			return result, err
		}
		result.SourceDeviceID, result.SN = id, sn
		deviceType := "standalone"
		if input.SourceKind == createdSourceDeviceTHCPNGateway {
			deviceType = "gateway"
		} else if input.SourceKind == createdSourceDeviceTHCPNNode {
			deviceType = "gateway_node"
		}
		synced, syncErr := s.syncCreatedTHCPNDevice(ctx, source, id, deviceType, input.ActorUserID)
		if syncErr != nil {
			result.SyncError = apperr.MessageOf(syncErr)
			return result, nil
		}
		result.PlatformDeviceID = &synced.Device.ID
		return result, nil
	case createdSourceDeviceCarbon:
		id, sn, err := createCarbonSourceDevice(ctx, source, input)
		if err != nil {
			return result, err
		}
		result.SourceDeviceID, result.SN = id, sn
		synced, syncErr := s.SyncCarbonDevice(ctx, SyncCarbonDeviceInput{DataSourceID: input.DataSourceID, ExternalDeviceID: id, ActorUserID: input.ActorUserID})
		if syncErr != nil {
			result.SyncError = apperr.MessageOf(syncErr)
			return result, nil
		}
		result.PlatformDeviceID = &synced.Device.ID
		return result, nil
	default:
		return result, apperr.New(apperr.KindInvalidArgument, "invalid source_kind")
	}
}

func createTHCPNSourceDevice(ctx context.Context, source sqlc.DataSource, input CreateSourceDeviceInput) (int64, string, error) {
	name, iccid, version := strings.TrimSpace(input.Name), strings.TrimSpace(input.ICCID), strings.TrimSpace(input.Version)
	if version == "" {
		version = "2.0"
	}
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 255 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid thcpn device name")
	}
	if iccid == "" || !utf8.ValidString(iccid) || utf8.RuneCountInString(iccid) > 50 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid iccid")
	}
	if version != "1.0" && version != "2.0" {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid thcpn version")
	}
	deviceType := "0"
	if input.SourceKind == createdSourceDeviceTHCPNGateway {
		deviceType = "10"
	} else if input.SourceKind == createdSourceDeviceTHCPNNode {
		deviceType = "11"
	}
	db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return 0, "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "begin thcpn device creation", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	created, err := tx.ExecContext(ctx, `INSERT INTO devices (name, iccid, version, status, device_type, avatar, sn) VALUES (?, ?, ?, 'normal', ?, '', '')`, name, iccid, version, deviceType)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert thcpn device", err)
	}
	id, err := created.LastInsertId()
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "read thcpn device id", err)
	}
	sn := createdSourceDeviceSN("thcreate.v1.", id)
	if _, err := tx.ExecContext(ctx, `UPDATE devices SET sn = ? WHERE id = ?`, sn, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "set thcpn device sn", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO device_config (device_id, data, image, control, version, uuid, is_mg) VALUES (?, '[]', '[]', '{}', ?, ?, 0)`, id, version, uuid.NewString()); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert thcpn device config", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "commit thcpn device creation", err)
	}
	committed = true
	return id, sn, nil
}

func createCarbonSourceDevice(ctx context.Context, source sqlc.DataSource, input CreateSourceDeviceInput) (int64, string, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" || !utf8.ValidString(name) || utf8.RuneCountInString(name) > 32 {
		return 0, "", apperr.New(apperr.KindInvalidArgument, "invalid carbon device name")
	}
	nodesCount, err := normalizeCarbonNodesCount(input.NodesCount)
	if err != nil {
		return 0, "", err
	}
	db, err := NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return 0, "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "begin carbon device creation", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	created, err := tx.ExecContext(ctx, `INSERT INTO devices (name, device_type, sn, nodes_count) VALUES (?, 'carbon-sink-v2', '', ?)`, name, nodesCount)
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert carbon device", err)
	}
	id, err := created.LastInsertId()
	if err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "read carbon device id", err)
	}
	sn := createdSourceDeviceSN("thcreate.v3.", id)
	if _, err := tx.ExecContext(ctx, `UPDATE devices SET sn = ? WHERE id = ?`, sn, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "set carbon device sn", err)
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO device_configs (device_id, data, image, control) VALUES (?, '[]', '[]', '{}')`, id); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "insert carbon device config", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, "", apperr.Wrap(apperr.KindDataSource, "commit carbon device creation", err)
	}
	committed = true
	return id, sn, nil
}

func (s *Service) syncCreatedTHCPNDevice(ctx context.Context, source sqlc.DataSource, externalID int64, deviceType string, actorID uuid.UUID) (THCPNStandardStationSyncResult, error) {
	input := thcpnDeviceSyncInput{ExternalDeviceID: externalID, DeviceType: deviceType, ActorUserID: actorID}
	if err := validateTHCPNDeviceSyncInput(input); err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	db, err := NewRuntime(nil).openMySQL(ctx, dataSourceFromSQL(source))
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	input, err = prepareTHCPNSync(ctx, db, input)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin created thcpn device sync", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	result, err := s.syncTHCPNDevice(ctx, s.queries.WithTx(tx), source, input)
	if err != nil {
		return THCPNStandardStationSyncResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return THCPNStandardStationSyncResult{}, apperr.Wrap(apperr.KindInternal, "commit created thcpn device sync", err)
	}
	committed = true
	return result, nil
}

func (s *Service) RetryCreatedSourceDeviceSync(ctx context.Context, dataSourceID uuid.UUID, sourceKind string, sourceDeviceID int64, actorID uuid.UUID) (CreatedSourceDevice, error) {
	if dataSourceID == uuid.Nil || sourceDeviceID <= 0 || actorID == uuid.Nil {
		return CreatedSourceDevice{}, apperr.New(apperr.KindInvalidArgument, "data source, source device and actor are required")
	}
	result := CreatedSourceDevice{DataSourceID: dataSourceID, SourceDeviceID: sourceDeviceID, SourceKind: sourceKind}
	family, err := sourceFamilyForCreatedDeviceKind(sourceKind)
	if err != nil {
		return result, err
	}
	source, err := s.loadMySQLDataSourceForFamily(ctx, dataSourceID, family)
	if err != nil {
		return result, err
	}
	if sourceKind == createdSourceDeviceCarbon {
		synced, err := s.SyncCarbonDevice(ctx, SyncCarbonDeviceInput{DataSourceID: dataSourceID, ExternalDeviceID: sourceDeviceID, ActorUserID: actorID})
		if err != nil {
			result.SyncError = apperr.MessageOf(err)
			return result, nil
		}
		result.PlatformDeviceID = &synced.Device.ID
		return result, nil
	}
	if sourceKind != createdSourceDeviceTHCPNStandard && sourceKind != createdSourceDeviceTHCPNGateway && sourceKind != createdSourceDeviceTHCPNNode {
		return result, apperr.New(apperr.KindInvalidArgument, "invalid source_kind")
	}
	deviceType := "standalone"
	if sourceKind == createdSourceDeviceTHCPNGateway {
		deviceType = "gateway"
	} else if sourceKind == createdSourceDeviceTHCPNNode {
		deviceType = "gateway_node"
	}
	synced, err := s.syncCreatedTHCPNDevice(ctx, source, sourceDeviceID, deviceType, actorID)
	if err != nil {
		result.SyncError = apperr.MessageOf(err)
		return result, nil
	}
	result.PlatformDeviceID = &synced.Device.ID
	return result, nil
}

func sourceFamilyForCreatedDeviceKind(kind string) (string, error) {
	switch kind {
	case createdSourceDeviceTHCPNStandard, createdSourceDeviceTHCPNGateway, createdSourceDeviceTHCPNNode:
		return sourceFamilyTHCPN, nil
	case createdSourceDeviceCarbon:
		return sourceFamilyCarbon, nil
	default:
		return "", apperr.New(apperr.KindInvalidArgument, "invalid source_kind")
	}
}

func normalizeCarbonNodesCount(value *int64) (int64, error) {
	if value == nil {
		return 16, nil
	}
	if *value <= 0 || *value > math.MaxUint32 {
		return 0, apperr.New(apperr.KindInvalidArgument, "invalid nodes_count")
	}
	return *value, nil
}
