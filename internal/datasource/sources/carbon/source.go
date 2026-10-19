package carbon

import (
	"context"
	platform "thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/db/sqlc"

	"github.com/google/uuid"
)

func (s *Service) loadCarbonSyncDataSource(ctx context.Context, dataSourceID uuid.UUID) (sqlc.DataSource, error) {
	return s.LoadMySQLDataSourceForFamily(ctx, dataSourceID, platform.SourceFamilyCarbon)
}
