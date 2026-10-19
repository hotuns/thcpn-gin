package thcpn

import (
	"context"
	"encoding/json"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) RegisterFirmware(ctx context.Context, input platform.SourceFirmwareInput) (int64, error) {
	if input.ExternalDeviceID <= 0 {
		return 0, apperr.New(apperr.KindInvalidArgument, "source firmware target is invalid")
	}
	source, err := s.LoadMySQLDataSourceForFamily(ctx, input.DataSourceID, "thcpn")
	if err != nil {
		return 0, err
	}

	db, err := s.Runtime.OpenMySQLDatabase(ctx, platform.DataSourceFromSQL(source), "")
	if err != nil {
		return 0, err
	}
	deviceIDs, _ := json.Marshal([]int64{input.ExternalDeviceID})
	result, err := db.ExecContext(ctx, `INSERT INTO device_firmwares(device_type,device_id,build,input.Version,uri,path,algorithm,hashvalue,created_at,updated_at) VALUES(NULL,?,NULL,?,?,NULL,'MD5',?,NOW(),NOW())`, string(deviceIDs), input.Version, input.PublicURL, input.VerifyValue)
	if err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "insert thcpn firmware record", err)
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, apperr.Wrap(apperr.KindDataSource, "read thcpn firmware id", err)
	}
	return id, nil
}
