package carbon

import (
	"context"
	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) DeleteUnusedSourceDevice(ctx context.Context, sourceID uuid.UUID, id int64, execute bool) (platform.SourceDeletion, error) {
	source, err := s.LoadMySQLDataSourceForFamily(ctx, sourceID, "carbon")
	if err != nil {
		return platform.SourceDeletion{}, err
	}
	db, err := s.Runtime.OpenMySQLDatabase(ctx, platform.DataSourceFromSQL(source), carbonDatabaseName)
	if err != nil {
		return platform.SourceDeletion{}, err
	}
	return platform.CheckManagedMySQLDeletion(ctx, db, id, "thcreate.v3.", "device_configs", "misc IS NULL OR JSON_TYPE(misc)='NULL' OR (JSON_TYPE(misc)='OBJECT' AND JSON_LENGTH(misc)=0)", "^(device_(data|data_next|attribute|log)|carbon_flux)(_[0-9]+)?$", nil, execute)
}
