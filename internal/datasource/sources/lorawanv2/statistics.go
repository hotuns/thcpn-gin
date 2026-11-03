package lorawanv2

import (
	"context"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
)

func (s *Service) ObservationStatistics(ctx context.Context, id uuid.UUID, start, end time.Time) (platform.ObservationStatistics, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	result := platform.ObservationStatistics{Identity: platform.ObservationIdentity(ref.DataSourceID, platform.SourceFamilyLoRaWANV2, ref.GatewaySN)}
	// Nodes currently belong to the gateway device UUID, rather than separate
	// platform devices. Any node binding makes this an unsupported observation
	// source, not an excluded status-only gateway. Do not use physical node SN as
	// observation identity: historical observations belong to gatewaySN/nodeIndex.
	var hasNodes bool
	err = s.DB.QueryRow(ctx, `SELECT EXISTS (
 SELECT 1 FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id
 WHERE ds.device_id=$1 AND b.status='active' AND b.adapter_code='lorawan_v2'
 AND b.adapter_config_json->>'node_index' IS NOT NULL
 UNION ALL SELECT 1 FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND node_index IS NOT NULL
 )`, id).Scan(&hasNodes)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	result.Excluded = !hasNodes
	// HTTP pagination.total_count includes invalid timestamp documents, so it
	// cannot provide accurate totals or daily counts. A gateway's newest node
	// cannot establish freshness of all its nodes. Leave extrema and interval
	// unknown, and never page through the complete remote history here.
	return result, nil
}
