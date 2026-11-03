package lorawanv2

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/observation"
)

func (s *Service) ObservationStatistics(ctx context.Context, id uuid.UUID, start, end time.Time) (platform.ObservationStatistics, error) {
	ref, err := s.LoRaWANV2GatewayForDevice(ctx, id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	source, err := s.loadLoRaWANV2DataSource(ctx, ref.DataSourceID)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	client, err := newLoRaWANV2Client(ctx, s.Runtime.Resolver, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	current, err := readPhysicalNodes(ctx, client, ref.GatewaySN)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	positions, err := s.statisticsPositions(ctx, ref)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	bound := make(map[int]bool, len(current.Data))
	for _, node := range current.Data {
		positions[*node.NodeIndex] = true
		bound[*node.NodeIndex] = true
	}
	nodes := make([]int, 0, len(positions))
	for node := range positions {
		nodes = append(nodes, node)
	}
	sort.Ints(nodes)
	identity := platform.ObservationIdentity(ref.DataSourceID, platform.SourceFamilyLoRaWANV2, ref.GatewaySN)
	if len(nodes) == 0 {
		// The current-binding endpoint cannot rule out source-only historical
		// positions. An empty inventory is unknown, not proof of zero observations.
		return platform.ObservationStatistics{Identity: identity}, nil
	}
	result := platform.NewRecordStatistics(identity, time.Unix(start.Unix(), 0), time.Unix(end.Unix(), 0)).Result()
	// Bound nodes plus retained platform mappings are a known subset. The source
	// has no historical-position manifest, so never claim full gateway coverage.
	result.RecordsPartial = true
	confirmed := 0
	for _, node := range nodes {
		cutoff, err := (observation.Service{DB: s.DB}).DeviceStart(ctx, id, node)
		if err != nil {
			return platform.ObservationStatistics{}, platform.StatisticsSourceError()
		}
		// Sequential requests stay within the upstream's four-request capacity;
		// the caller's refresh deadline covers the entire gateway, not each node.
		item, err := client.observationStatistics(ctx, ref.GatewaySN, node, cutoff, start, end)
		// Retained projections can name positions that never existed upstream.
		// Only the explicit absence code for an unbound candidate is skippable.
		if errors.Is(err, errStatisticsPositionNotFound) && !bound[node] {
			continue
		}
		if err != nil || *item.TotalRecords > math.MaxInt64-*result.TotalRecords {
			return platform.ObservationStatistics{}, platform.StatisticsSourceError()
		}
		confirmed++
		*result.TotalRecords += *item.TotalRecords
		for i, day := range item.Days {
			if *day.Records > math.MaxInt64-*result.Days[i].Records {
				return platform.ObservationStatistics{}, platform.StatisticsSourceError()
			}
			*result.Days[i].Records += *day.Records
		}
		if item.FirstObservedAt != nil && (result.FirstObservedAt == nil || item.FirstObservedAt.Before(*result.FirstObservedAt)) {
			result.FirstObservedAt = item.FirstObservedAt
		}
		if item.LastObservedAt != nil && (result.LastObservedAt == nil || item.LastObservedAt.After(*result.LastObservedAt)) {
			result.LastObservedAt = item.LastObservedAt
		}
	}
	if confirmed == 0 {
		return platform.ObservationStatistics{Identity: identity}, nil
	}
	return result, nil
}

func (s *Service) statisticsPositions(ctx context.Context, ref LoRaWANV2GatewayRef) (map[int]bool, error) {
	// Disabled metric bindings and retained configurations keep historical slots
	// discoverable after physical replacement/unbinding. Never count per metric or
	// synthesize 1..node_count: node_count is capacity and positions can be sparse.
	rows, err := s.DB.Query(ctx, `WITH candidates AS (
 SELECT CASE WHEN b.adapter_config_json->>'node_index' ~ '^[0-9]{1,3}$'
 THEN (b.adapter_config_json->>'node_index')::integer END AS node_index
 FROM data_streams ds JOIN data_stream_bindings b ON b.data_stream_id=ds.id
 WHERE ds.device_id=$1 AND b.adapter_code='lorawan_v2' AND b.data_source_id=$2
 AND b.adapter_config_json->>'gateway_sn'=$3
 UNION ALL SELECT node_index FROM lorawan_v2_node_config_snapshots WHERE device_id=$1
 UNION ALL SELECT node_index FROM lorawan_physical_nodes WHERE gateway_device_id=$1 AND data_source_id=$2
 ) SELECT DISTINCT node_index FROM candidates WHERE node_index BETWEEN 1 AND 254`, ref.DeviceID, ref.DataSourceID, ref.GatewaySN)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	positions := make(map[int]bool)
	for rows.Next() {
		var node int
		if err := rows.Scan(&node); err != nil {
			return nil, err
		}
		positions[node] = true
	}
	return positions, rows.Err()
}
