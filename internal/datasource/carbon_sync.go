package datasource

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/db/sqlc"
)

const carbonDatabaseName = "carbon_sink_v2"

type CarbonDevice struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	DeviceType string     `json:"device_type"`
	SN         string     `json:"sn"`
	NodesCount int        `json:"nodes_count"`
	CreatedAt  *time.Time `json:"created_at,omitempty"`
	UpdatedAt  *time.Time `json:"updated_at,omitempty"`
}

type CarbonDeviceInformation struct {
	ICCID           string `json:"iccid,omitempty"`
	Latitude        string `json:"latitude,omitempty"`
	Longitude       string `json:"longitude,omitempty"`
	Altitude        string `json:"altitude,omitempty"`
	Battery         string `json:"battery,omitempty"`
	Signal          string `json:"signal,omitempty"`
	Network         string `json:"network,omitempty"`
	Avatar          string `json:"avatar,omitempty"`
	CurrentFirmware string `json:"current_firmware_version,omitempty"`
	Address         string `json:"address,omitempty"`
}

type CarbonDeviceSyncResult struct {
	Device         SyncedDevice    `json:"device"`
	SourceRef      DeviceSourceRef `json:"source_ref"`
	ExternalDevice CarbonDevice    `json:"external_device"`
	NodesCount     int             `json:"nodes_count"`
}

type CarbonDeviceSyncFailure struct {
	ExternalDeviceID int64  `json:"external_device_id"`
	Error            string `json:"error"`
}

type CarbonAllDevicesSyncResult struct {
	DataSourceID uuid.UUID                 `json:"data_source_id"`
	Total        int                       `json:"total"`
	Synced       int                       `json:"synced"`
	Created      int                       `json:"created"`
	Updated      int                       `json:"updated"`
	Failed       int                       `json:"failed"`
	Failures     []CarbonDeviceSyncFailure `json:"failures,omitempty"`
}

type SyncCarbonDeviceInput struct {
	DataSourceID     uuid.UUID
	ExternalDeviceID int64
	ActorUserID      uuid.UUID
}

type SyncAllCarbonDevicesInput struct {
	DataSourceID uuid.UUID
	ActorUserID  uuid.UUID
}

func (s *Service) ListCarbonDevices(ctx context.Context, dataSourceID uuid.UUID) ([]CarbonDevice, error) {
	if dataSourceID == uuid.Nil {
		return nil, apperr.New(apperr.KindInvalidArgument, "data_source_id is required")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, dataSourceID)
	if err != nil {
		return nil, err
	}
	db, err := NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	return readAllCarbonDevices(ctx, db)
}

func (s *Service) SyncCarbonDevice(ctx context.Context, input SyncCarbonDeviceInput) (CarbonDeviceSyncResult, error) {
	if err := validateCarbonSyncInput(input.DataSourceID, input.ExternalDeviceID, input.ActorUserID); err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	db, err := NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	defer db.Close()
	external, err := readCarbonDevice(ctx, db, input.ExternalDeviceID)
	if err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	information, err := readCarbonDeviceInformation(ctx, db, input.ExternalDeviceID)
	if err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return CarbonDeviceSyncResult{}, apperr.Wrap(apperr.KindInternal, "begin carbon device sync", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(ctx)
		}
	}()
	result, err := s.syncCarbonDevice(ctx, s.queries.WithTx(tx), source, external, information, input.ActorUserID)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	committed = true
	return result, nil
}

func (s *Service) SyncAllCarbonDevices(ctx context.Context, input SyncAllCarbonDevicesInput) (CarbonAllDevicesSyncResult, error) {
	result := CarbonAllDevicesSyncResult{DataSourceID: input.DataSourceID, Failures: []CarbonDeviceSyncFailure{}}
	if input.DataSourceID == uuid.Nil || input.ActorUserID == uuid.Nil {
		return result, apperr.New(apperr.KindInvalidArgument, "data source and actor are required")
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, input.DataSourceID)
	if err != nil {
		return result, err
	}
	db, err := NewRuntime(nil).openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return result, err
	}
	defer db.Close()
	devices, err := readAllCarbonDevices(ctx, db)
	if err != nil {
		return result, err
	}
	result.Total = len(devices)
	for _, external := range devices {
		if err := ctx.Err(); err != nil {
			return result, apperr.Wrap(apperr.KindInternal, "carbon full sync canceled", err)
		}
		_, lookupErr := s.queries.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
			DataSourceID: input.DataSourceID, AdapterCode: AdapterCarbonSink, ExternalDeviceID: external.ID,
		})
		existed := lookupErr == nil
		if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
			result.Failed++
			result.Failures = append(result.Failures, CarbonDeviceSyncFailure{ExternalDeviceID: external.ID, Error: apperr.MessageOf(lookupErr)})
			continue
		}
		tx, txErr := s.db.BeginTx(ctx, pgx.TxOptions{})
		if txErr != nil {
			return result, apperr.Wrap(apperr.KindInternal, "begin carbon full sync", txErr)
		}
		information, infoErr := readCarbonDeviceInformation(ctx, db, external.ID)
		if infoErr != nil {
			_ = tx.Rollback(ctx)
			result.Failed++
			result.Failures = append(result.Failures, CarbonDeviceSyncFailure{ExternalDeviceID: external.ID, Error: apperr.MessageOf(infoErr)})
			continue
		}
		item, syncErr := s.syncCarbonDevice(ctx, s.queries.WithTx(tx), source, external, information, input.ActorUserID)
		if syncErr == nil {
			syncErr = tx.Commit(ctx)
		} else {
			_ = tx.Rollback(ctx)
		}
		if syncErr != nil {
			result.Failed++
			result.Failures = append(result.Failures, CarbonDeviceSyncFailure{ExternalDeviceID: external.ID, Error: apperr.MessageOf(syncErr)})
			continue
		}
		result.Synced++
		if existed {
			result.Updated++
		} else {
			result.Created++
		}
		_ = item
	}
	return result, nil
}

func (s *Service) syncCarbonDevice(ctx context.Context, q *sqlc.Queries, source sqlc.DataSource, external CarbonDevice, information *CarbonDeviceInformation, actorID uuid.UUID) (CarbonDeviceSyncResult, error) {
	serialNo := strings.TrimSpace(external.SN)
	name := strings.TrimSpace(external.Name)
	if name == "" {
		name = serialNo
	}
	if name == "" {
		name = fmt.Sprintf("碳汇设备 %d", external.ID)
	}
	ref, refErr := q.GetDeviceSourceRefByExternal(ctx, sqlc.GetDeviceSourceRefByExternalParams{
		DataSourceID: source.ID, AdapterCode: AdapterCarbonSink, ExternalDeviceID: external.ID,
	})
	var device sqlc.Device
	var err error
	if refErr == nil {
		device, err = q.GetDevice(ctx, ref.DeviceID)
		if err != nil {
			return CarbonDeviceSyncResult{}, mapNotFoundOrInternal(err, "mapped carbon device not found")
		}
		device, err = q.UpdateDevice(ctx, sqlc.UpdateDeviceParams{ID: device.ID, ProductID: optionalString("carbon_sink_v2"), Name: name, Status: device.Status})
		if err != nil {
			return CarbonDeviceSyncResult{}, mapWriteError(err, "update carbon device")
		}
		device, err = q.UpdateDeviceType(ctx, sqlc.UpdateDeviceTypeParams{ID: device.ID, DeviceType: "carbon_sink"})
		if err != nil {
			return CarbonDeviceSyncResult{}, mapWriteError(err, "update carbon device type")
		}
	} else if errors.Is(refErr, pgx.ErrNoRows) {
		device, err = q.CreateDevice(ctx, sqlc.CreateDeviceParams{ProductID: optionalString("carbon_sink_v2"), Name: name})
		if err != nil {
			return CarbonDeviceSyncResult{}, mapWriteError(err, "create carbon device")
		}
		device, err = q.UpdateDeviceType(ctx, sqlc.UpdateDeviceTypeParams{ID: device.ID, DeviceType: "carbon_sink"})
		if err != nil {
			return CarbonDeviceSyncResult{}, mapWriteError(err, "set carbon device type")
		}
	} else {
		return CarbonDeviceSyncResult{}, apperr.Wrap(apperr.KindInternal, "lookup carbon device source ref", refErr)
	}
	ref, err = q.UpsertDeviceSourceRef(ctx, sqlc.UpsertDeviceSourceRefParams{DeviceID: device.ID, DataSourceID: source.ID, AdapterCode: AdapterCarbonSink, ExternalDeviceID: external.ID})
	if err != nil {
		return CarbonDeviceSyncResult{}, mapWriteError(err, "upsert carbon device source ref")
	}
	if err := upsertCarbonNodeMetadata(ctx, q, device.ID, actorID, external.NodesCount); err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	if err := syncCarbonDeviceInformation(ctx, q, device.ID, information, actorID); err != nil {
		return CarbonDeviceSyncResult{}, err
	}
	return CarbonDeviceSyncResult{Device: syncedDeviceFromSQL(device, nil), SourceRef: deviceSourceRefFromSQL(ref), ExternalDevice: external, NodesCount: external.NodesCount}, nil
}

func syncCarbonDeviceInformation(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, information *CarbonDeviceInformation, actorID uuid.UUID) error {
	if information == nil {
		return nil
	}
	if err := q.DeleteCarbonRuntimeMetadata(ctx, sqlc.DeleteCarbonRuntimeMetadataParams{DeviceID: deviceID, Column2: []string{"carbon_battery", "carbon_signal", "carbon_network"}}); err != nil {
		return mapWriteError(err, "remove stale carbon runtime metadata")
	}
	values := []struct{ key, name, valueType, unit, value string }{
		{"carbon_iccid", "ICCID", "string", "", information.ICCID},
		{"carbon_latitude", "纬度", "number", "°", information.Latitude},
		{"carbon_longitude", "经度", "number", "°", information.Longitude},
		{"carbon_altitude", "海拔", "number", "m", information.Altitude},
		{"carbon_firmware_version", "固件版本", "string", "", information.CurrentFirmware},
		{"carbon_address", "设备地址", "string", "", information.Address},
	}
	for _, item := range values {
		if strings.TrimSpace(item.value) == "" {
			continue
		}
		valueType := item.valueType
		valueJSON := []byte(strconv.Quote(item.value))
		if valueType == "number" {
			parsed, err := strconv.ParseFloat(strings.TrimSpace(item.value), 64)
			if err != nil {
				continue
			}
			valueJSON = []byte(strconv.FormatFloat(parsed, 'f', -1, 64))
		}
		var unit *string
		if item.unit != "" {
			unit = &item.unit
		}
		if err := q.UpsertCarbonMetadata(ctx, sqlc.UpsertCarbonMetadataParams{DeviceID: deviceID, Key: item.key, Name: item.name, ValueType: valueType, Column5: valueJSON, Unit: unit, CreatedBy: actorID}); err != nil {
			return mapWriteError(err, "upsert carbon device information")
		}
	}
	if information.Avatar != "" {
		if err := syncCarbonDeviceAvatar(ctx, q, deviceID, information.Avatar); err != nil {
			return err
		}
	}
	return nil
}

func syncCarbonDeviceAvatar(ctx context.Context, q *sqlc.Queries, deviceID uuid.UUID, avatar string) error {
	avatar = strings.TrimSpace(strings.ReplaceAll(avatar, `\/`, "/"))
	if avatar == "" {
		return nil
	}
	return func() error {
		existing, err := q.ListDeviceProfileImages(ctx, deviceID)
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "list carbon device images", err)
		}
		for _, image := range existing {
			if image.SourceUrl != nil && *image.SourceUrl == avatar {
				return nil
			}
		}
		_, err = q.CreateDeviceProfileImage(ctx, sqlc.CreateDeviceProfileImageParams{DeviceID: deviceID, ObjectKey: avatar, OriginalFilename: "carbon-device", ContentType: "image/jpeg", SizeBytes: 0, SortOrder: int32(len(existing)), IsCover: len(existing) == 0, UploadedBy: nil, SourceUrl: &avatar, Caption: nil})
		if err != nil {
			return apperr.Wrap(apperr.KindInternal, "create carbon device image", err)
		}
		return nil
	}()
}

func upsertCarbonNodeMetadata(ctx context.Context, q *sqlc.Queries, deviceID, actorID uuid.UUID, nodesCount int) error {
	if nodesCount < 0 {
		nodesCount = 0
	}
	err := q.UpsertCarbonNodeMetadata(ctx, sqlc.UpsertCarbonNodeMetadataParams{
		DeviceID:  deviceID,
		Column2:   []byte(fmt.Sprintf("%d", nodesCount)),
		CreatedBy: actorID,
	})
	if err != nil {
		return mapWriteError(err, "upsert carbon node metadata")
	}
	return nil
}

func readAllCarbonDevices(ctx context.Context, db *sql.DB) ([]CarbonDevice, error) {
	rows, err := db.QueryContext(ctx, `SELECT id, name, CAST(device_type AS CHAR), sn, nodes_count, created_at, updated_at FROM devices WHERE deleted_at IS NULL AND device_type = 'carbon-sink-v2' ORDER BY id`)
	if err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read carbon devices", err)
	}
	defer rows.Close()
	result := make([]CarbonDevice, 0)
	for rows.Next() {
		item, err := scanCarbonDevice(rows)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "scan carbon device", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, apperr.Wrap(apperr.KindDataSource, "read carbon devices", err)
	}
	return result, nil
}

func readCarbonDevice(ctx context.Context, db *sql.DB, externalID int64) (CarbonDevice, error) {
	row := db.QueryRowContext(ctx, `SELECT id, name, CAST(device_type AS CHAR), sn, nodes_count, created_at, updated_at FROM devices WHERE id = ? AND deleted_at IS NULL AND device_type = 'carbon-sink-v2'`, externalID)
	item, err := scanCarbonDevice(row)
	if errors.Is(err, sql.ErrNoRows) {
		return CarbonDevice{}, apperr.New(apperr.KindNotFound, "carbon v2 device not found")
	}
	if err != nil {
		return CarbonDevice{}, apperr.Wrap(apperr.KindDataSource, "read carbon device", err)
	}
	return item, nil
}

func readCarbonDeviceInformation(ctx context.Context, db *sql.DB, externalID int64) (*CarbonDeviceInformation, error) {
	row := db.QueryRowContext(ctx, "SELECT CAST(iccid AS CHAR), CAST(latitude AS CHAR), CAST(longitude AS CHAR), CAST(altitude AS CHAR), CAST(battery AS CHAR), CAST(`signal` AS CHAR), CAST(network AS CHAR), CAST(avatar AS CHAR), CAST(current_firmware_version AS CHAR), CAST(address AS CHAR) FROM device_informations WHERE device_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", externalID)
	var values [10]sql.NullString
	args := make([]any, len(values))
	for index := range values {
		args[index] = &values[index]
	}
	if err := row.Scan(args...); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, apperr.Wrap(apperr.KindDataSource, "read carbon device information", err)
	}
	value := func(index int) string {
		if values[index].Valid {
			return strings.TrimSpace(values[index].String)
		}
		return ""
	}
	return &CarbonDeviceInformation{ICCID: value(0), Latitude: value(1), Longitude: value(2), Altitude: value(3), Battery: value(4), Signal: value(5), Network: value(6), Avatar: value(7), CurrentFirmware: value(8), Address: value(9)}, nil
}

type carbonDeviceScanner interface{ Scan(...any) error }

func scanCarbonDevice(scanner carbonDeviceScanner) (CarbonDevice, error) {
	var item CarbonDevice
	var createdAt, updatedAt sql.NullTime
	if err := scanner.Scan(&item.ID, &item.Name, &item.DeviceType, &item.SN, &item.NodesCount, &createdAt, &updatedAt); err != nil {
		return item, err
	}
	if createdAt.Valid {
		item.CreatedAt = &createdAt.Time
	}
	if updatedAt.Valid {
		item.UpdatedAt = &updatedAt.Time
	}
	return item, nil
}

func validateCarbonSyncInput(dataSourceID uuid.UUID, externalID int64, actorID uuid.UUID) error {
	if dataSourceID == uuid.Nil || actorID == uuid.Nil {
		return apperr.New(apperr.KindInvalidArgument, "data source and actor are required")
	}
	if externalID <= 0 {
		return apperr.New(apperr.KindInvalidArgument, "external_device_id is required")
	}
	return nil
}
