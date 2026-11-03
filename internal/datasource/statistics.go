package datasource

import (
	"context"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

// ObservationStatistics reads one source identity. Authorization, caching and
// workspace aggregation belong to the caller. The caller's context deadline is
// shared by every query; statistics never replace it with per-table timeouts.
func (s *Service) ObservationStatistics(ctx context.Context, deviceID uuid.UUID, start, end time.Time) (platform.ObservationStatistics, error) {
	if deviceID == uuid.Nil || start.IsZero() || end.IsZero() || !start.Before(end) {
		return platform.ObservationStatistics{}, apperr.New(apperr.KindInvalidArgument, "invalid observation statistics window")
	}
	if s.DB == nil {
		return platform.ObservationStatistics{}, apperr.New(apperr.KindInternal, "database is not configured")
	}
	var family, key string
	var sourceID uuid.UUID
	err := s.DB.QueryRow(ctx, `SELECT source.id,COALESCE(source.source_family,''),ref.external_key
 FROM device_source_refs ref JOIN data_sources source ON source.id=ref.data_source_id
 WHERE ref.device_id=$1 AND ref.status='active' AND source.status='active'`, deviceID).Scan(&sourceID, &family, &key)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	if module, ok := s.modules[family]; ok && module.Statistics != nil {
		return module.Statistics(ctx, deviceID, start, end)
	}
	// A real but unsupported family must stay in coverage denominators.
	return platform.ObservationStatistics{Identity: platform.ObservationIdentity(sourceID, family, key)}, nil
}
