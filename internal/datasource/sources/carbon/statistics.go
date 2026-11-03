package carbon

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/observation"
)

func (s *Service) ObservationStatistics(ctx context.Context, id uuid.UUID, start, end time.Time) (platform.ObservationStatistics, error) {
	ref, db, err := s.openCarbonDeviceSource(ctx, id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	cutoff, err := (observation.Service{DB: s.DB}).DeviceStart(ctx, id, 0)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	overrides := map[int]time.Time{}
	rows, err := s.DB.Query(ctx, "SELECT node_index, starts_at FROM device_observation_starts WHERE device_id=$1 AND node_index>0", id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	for rows.Next() {
		var node int
		var at time.Time
		if rows.Scan(&node, &at) != nil {
			rows.Close()
			return platform.ObservationStatistics{}, platform.StatisticsSourceError()
		}
		overrides[node] = at
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	conn, close, err := platform.StatisticsConnection(ctx, db)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	defer close()
	identity := platform.ObservationIdentity(ref.DataSourceID, platform.SourceFamilyCarbon, strconv.FormatInt(ref.ExternalID, 10))
	result, err := readCarbonStatistics(ctx, conn, identity, ref.ExternalID, cutoff, overrides, start, end)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	var control []byte
	if conn.QueryRowContext(ctx, "SELECT control FROM device_configs WHERE device_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", ref.ExternalID).Scan(&control) == nil {
		// Carbon uses the same two-field capture/upload schedule keys.
		result.ExpectedIntervalSeconds = platform.StatisticsInterval(control)
	}
	return result, nil
}

func readCarbonStatistics(ctx context.Context, db platform.StatisticsQuerier, identity string, id int64, cutoff *time.Time, overrides map[int]time.Time, start, end time.Time) (platform.ObservationStatistics, error) {
	out := platform.NewRecordStatistics(identity, start, end)
	// This is the existing business-queryable device_data_next history, not a
	// claim that earlier device_data partitions were migrated completely. Never
	// combine old tables or derived carbon_flux rows with canonical raw records.
	rows, err := db.QueryContext(ctx, "SELECT table_name FROM information_schema.tables WHERE table_schema=? AND table_name LIKE 'device_data_next_%'", carbonDatabaseName)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	tables := map[string]bool{}
	for rows.Next() {
		var table string
		if rows.Scan(&table) != nil {
			rows.Close()
			return platform.ObservationStatistics{}, platform.StatisticsSourceError()
		}
		if _, ok := platform.StatisticsMonthlyTable(table, "device_data_next_"); ok {
			tables[table] = true
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	names := make([]string, 0, len(tables))
	for table := range tables {
		names = append(names, table)
	}
	sort.Strings(names)
	predicate, args := carbonStatisticsPredicate(id, cutoff, overrides, end)
	for _, table := range names {
		if err := out.AddTable(ctx, db, table, predicate, args, start); err != nil {
			return platform.ObservationStatistics{}, err
		}
	}
	// No observation-image adapter exists for Carbon; profile avatars are not
	// observed images. Both cumulative and daily image counts remain nil.
	return out.Result(), nil
}

func carbonStatisticsPredicate(id int64, cutoff *time.Time, overrides map[int]time.Time, end time.Time) (string, []any) {
	nodes := make([]int, 0, len(overrides))
	for node := range overrides {
		nodes = append(nodes, node)
	}
	sort.Ints(nodes)
	args := []any{id, platform.StatisticsWallTime(end)}
	lower := "?"
	if len(nodes) > 0 {
		var cases []string
		for _, node := range nodes {
			cases = append(cases, "WHEN ? THEN ?")
			at := overrides[node]
			args = append(args, node, platform.StatisticsWallTime(platform.StatisticsLowerBound(&at)))
		}
		lower = "CASE node_id " + strings.Join(cases, " ") + " ELSE ? END"
	}
	args = append(args, platform.StatisticsWallTime(platform.StatisticsLowerBound(cutoff)))
	return "device_id = ? AND type = 'data' AND deleted_at IS NULL AND ts IS NOT NULL AND ts < ? AND ts >= " + lower, args
}
