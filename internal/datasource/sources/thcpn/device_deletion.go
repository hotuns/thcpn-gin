package thcpn

import (
	"context"
	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) DeleteUnusedSourceDevice(ctx context.Context, sourceID uuid.UUID, id int64, execute bool) (platform.SourceDeletion, error) {
	source, err := s.LoadMySQLDataSourceForFamily(ctx, sourceID, "thcpn")
	if err != nil {
		return platform.SourceDeletion{}, err
	}
	db, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.SourceDeletion{}, err
	}
	return platform.CheckManagedMySQLDeletion(ctx, db, id, "thcreate.v1.", "device_config", "is_mg=0 AND (updated_at IS NULL OR updated_at=created_at)", "^device_(data|attribute|log)(_[0-9]+)?$", [][2]string{{"device_user", "device_id"}, {"gate_node", "gate_id"}, {"gate_node", "node_id"}, {"issue_tasks", "device_id"}}, execute)
}
