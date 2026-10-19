package carbon

import (
	"context"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) RegisterFirmware(ctx context.Context, input platform.SourceFirmwareInput) (int64, error) {
	if input.ExternalDeviceID <= 0 {
		return 0, apperr.New(apperr.KindInvalidArgument, "source firmware target is invalid")
	}
	source, err := s.LoadMySQLDataSourceForFamily(ctx, input.DataSourceID, "carbon")
	if err != nil {
		return 0, err
	}

	if input.BuildID == nil || *input.BuildID == 0 {
		return 0, apperr.New(apperr.KindInvalidArgument, "carbon firmware build_id is required")
	}
	db, err := s.Runtime.OpenMySQLDatabase(ctx, platform.DataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return 0, err
	}
	result, err := db.ExecContext(ctx, `INSERT INTO firmwares(device_id,input.Version,build_id,path,created_at,updated_at) VALUES(?,?,?,?,NOW(),NOW())`, input.ExternalDeviceID, input.Version, *input.BuildID, input.ObjectKey)
	if err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "insert carbon firmware record", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "read carbon firmware id", err)
	}
	return id, nil
}
