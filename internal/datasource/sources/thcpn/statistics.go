package thcpn

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
	ref, err := s.Queries.GetActiveTHCPNDeviceSourceRefByDevice(ctx, id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	device, err := s.Queries.GetDevice(ctx, id)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	cutoff, err := (observation.Service{DB: s.DB}).DeviceStart(ctx, id, 0)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	source, err := s.loadTHCPNSyncDataSource(ctx, ref.DataSourceID)
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	db, err := s.Runtime.OpenMySQL(ctx, platform.DataSourceFromSQL(source))
	if err != nil {
		return platform.ObservationStatistics{}, platform.StatisticsSourceError()
	}
	conn, close, err := platform.StatisticsConnection(ctx, db)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	defer close()
	identity := platform.ObservationIdentity(ref.DataSourceID, platform.SourceFamilyTHCPN, strconv.FormatInt(ref.ExternalDeviceID, 10))
	result, err := readTHCPNStatistics(ctx, conn, identity, ref.ExternalDeviceID, thcpnShardStrategyForDeviceType(device.DeviceType), cutoff, start, end)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	// Read only the latest control object, without GetSamplingProfile's projection
	// and audit queries. Optional plan failures must not erase successful counts.
	var control []byte
	if err := conn.QueryRowContext(ctx, "SELECT control FROM device_config WHERE device_id=? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1", ref.ExternalDeviceID).Scan(&control); err == nil {
		result.ExpectedIntervalSeconds = platform.StatisticsInterval(control)
	}
	return result, nil
}

type statisticsSpan struct{ start, end time.Time }

func readTHCPNStatistics(ctx context.Context, db platform.StatisticsQuerier, identity string, id int64, strategy string, cutoff *time.Time, start, end time.Time) (platform.ObservationStatistics, error) {
	out := platform.NewRecordStatistics(identity, start, end)
	lower := platform.StatisticsLowerBound(cutoff)
	if !lower.Before(end) {
		result := out.Result()
		initializeTHCPNImageCounts(&result)
		return result, nil
	}
	tables, err := thcpnStatisticsTables(ctx, db, strategy, lower, end)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	names := make([]string, 0, len(tables))
	for name := range tables {
		names = append(names, name)
	}
	sort.Strings(names)
	imageExpression, imageArgs, err := thcpnStatisticsImageExpression(ctx, db, id)
	if err != nil {
		return platform.ObservationStatistics{}, err
	}
	images := out.Result()
	initializeTHCPNImageCounts(&images)
	for _, table := range names {
		spans := tables[table]
		clauses := make([]string, 0, len(spans))
		args := []any{id}
		for _, span := range spans {
			clauses = append(clauses, "(ts >= ? AND ts < ?)")
			args = append(args, platform.StatisticsWallTime(span.start), platform.StatisticsWallTime(span.end))
		}
		predicate := "device_id = ? AND type = 'data' AND deleted_at IS NULL AND ts IS NOT NULL AND (" + strings.Join(clauses, " OR ") + ")"
		if err := out.AddTable(ctx, db, table, predicate, args, start); err != nil {
			return platform.ObservationStatistics{}, err
		}
		imagePredicate := strings.Replace(predicate, "type = 'data'", "type = 'image'", 1)
		if err := addTHCPNImageStatistics(ctx, db, &images, table, imagePredicate, args, imageExpression, imageArgs, start); err != nil {
			return platform.ObservationStatistics{}, err
		}
	}
	result := out.Result()
	result.TotalImages = images.TotalImages
	return result, nil
}

func thcpnStatisticsTables(ctx context.Context, db platform.StatisticsQuerier, strategy string, lower, end time.Time) (map[string][]statisticsSpan, error) {
	result := map[string][]statisticsSpan{}
	cutover := time.Date(2026, 7, 1, 0, 0, 0, 0, platform.LegacySourceLocation)
	indexEnd := end
	if strategy != thcpnShardStrategyIndex && cutover.Before(indexEnd) {
		indexEnd = cutover
	}
	if lower.Before(indexEnd) {
		// Enumerate real indexed tables, with no telemetry helper's 8-table cap.
		// An indexed but missing table is a dependency failure, not empty history.
		rows, err := db.QueryContext(ctx, "SELECT COALESCE(t.table_name, '') FROM device_data_index i LEFT JOIN information_schema.tables t ON t.table_schema=DATABASE() AND t.table_name=i.tb_name WHERE i.start_at < ? AND i.end_at >= ?", platform.StatisticsWallTime(indexEnd), platform.StatisticsWallTime(lower))
		if err != nil {
			return nil, platform.StatisticsSourceError()
		}
		for rows.Next() {
			var table string
			if rows.Scan(&table) != nil || validateTHCPNShardTableName(table) != nil {
				rows.Close()
				return nil, platform.StatisticsSourceError()
			}
			// Index entries may repeat a physical table; never count it twice.
			result[table] = []statisticsSpan{{lower, indexEnd}}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, platform.StatisticsSourceError()
		}
	}
	if strategy == thcpnShardStrategyIndex || !end.After(cutover) {
		return result, nil
	}
	monthlyStart := lower
	if cutover.After(monthlyStart) {
		monthlyStart = cutover
	}
	rows, err := db.QueryContext(ctx, "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'device_data_%'")
	if err != nil {
		return nil, platform.StatisticsSourceError()
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var table string
		if rows.Scan(&table) != nil {
			return nil, platform.StatisticsSourceError()
		}
		month, ok := platform.StatisticsMonthlyTable(table, thcpnMonthlyShardTablePrefix)
		if !ok || seen[table] {
			continue
		}
		seen[table] = true
		from, to := month, month.AddDate(0, 1, 0)
		if monthlyStart.After(from) {
			from = monthlyStart
		}
		if end.Before(to) {
			to = end
		}
		if from.Before(to) {
			result[table] = append(result[table], statisticsSpan{from, to})
		}
	}
	if rows.Err() != nil {
		return nil, platform.StatisticsSourceError()
	}
	return result, nil
}
