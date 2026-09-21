package datasource

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
)

type SourceFirmwareInput struct {
	DataSourceID     uuid.UUID
	SourceFamily     string
	ExternalDeviceID int64
	Version          string
	BuildID          *int64
	ObjectKey        string
	PublicURL        string
	VerifyValue      string
}

// RegisterSourceFirmware writes the source-native firmware record. Devices in
// these two source families poll their own database and object store; the
// platform intentionally does not create a platform-only device operation.
func (s *Service) RegisterSourceFirmware(ctx context.Context, input SourceFirmwareInput) (int64, error) {
	if input.DataSourceID == uuid.Nil || input.ExternalDeviceID <= 0 {
		return 0, apperr.New(apperr.KindInvalidArgument, "source firmware target is invalid")
	}
	version := strings.TrimSpace(input.Version)
	if version == "" {
		return 0, apperr.New(apperr.KindInvalidArgument, "firmware version is required")
	}
	source, err := s.queries.GetDataSource(ctx, input.DataSourceID)
	if err != nil {
		return 0, mapNotFoundOrInternal(err, "firmware data source not found")
	}
	if source.Status != "active" || source.SourceFamily == nil || *source.SourceFamily != input.SourceFamily {
		return 0, apperr.New(apperr.KindInvalidArgument, "firmware data source family is invalid")
	}
	runtime := NewRuntime(nil)
	switch input.SourceFamily {
	case sourceFamilyTHCPN:
		db, err := runtime.openMySQLDatabase(ctx, dataSourceFromSQL(source), "")
		if err != nil {
			return 0, err
		}
		deviceIDs, _ := json.Marshal([]int64{input.ExternalDeviceID})
		result, err := db.ExecContext(ctx, `INSERT INTO device_firmwares(device_type,device_id,build,version,uri,path,algorithm,hashvalue,created_at,updated_at) VALUES(NULL,?,NULL,?,?,NULL,'MD5',?,NOW(),NOW())`, string(deviceIDs), version, input.PublicURL, input.VerifyValue)
		if err != nil {
			return 0, apperr.Wrap(apperr.KindDataSource, "insert thcpn firmware record", err)
		}
		id, err := result.LastInsertId()
		if err != nil {
			return 0, apperr.Wrap(apperr.KindDataSource, "read thcpn firmware id", err)
		}
		return id, nil
	case sourceFamilyCarbon:
		if input.BuildID == nil || *input.BuildID == 0 {
			return 0, apperr.New(apperr.KindInvalidArgument, "carbon firmware build_id is required")
		}
		db, err := runtime.openMySQLDatabase(ctx, dataSourceFromSQL(source), carbonDatabaseName)
		if err != nil {
			return 0, err
		}
		result, err := db.ExecContext(ctx, `INSERT INTO firmwares(device_id,version,build_id,path,created_at,updated_at) VALUES(?,?,?,?,NOW(),NOW())`, input.ExternalDeviceID, version, *input.BuildID, input.ObjectKey)
		if err != nil {
			return 0, apperr.Wrap(apperr.KindDataSource, "insert carbon firmware record", err)
		}
		id, err := result.LastInsertId()
		if err != nil {
			return 0, apperr.Wrap(apperr.KindDataSource, "read carbon firmware id", err)
		}
		return id, nil
	default:
		return 0, apperr.New(apperr.KindInvalidArgument, "source firmware database writer is not supported")
	}
}
