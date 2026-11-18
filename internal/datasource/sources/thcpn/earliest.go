package thcpn

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform"
)

type earliestShard struct {
	table string
	span  statisticsSpan
	first time.Time
}

type earliestSample struct {
	stream uuid.UUID
	point  platform.TelemetryPoint
}

func (r *Runtime) queryEarliestTelemetry(ctx context.Context, source platform.DataSource, req platform.TelemetryBatchQuery, metrics []thcpnBatchMetric) (platform.TelemetryBatchResult, error) {
	result := platform.TelemetryBatchResult{Series: make(map[uuid.UUID]platform.TelemetryResult, len(metrics))}
	if source.Type != "mysql" {
		return result, apperr.New(apperr.KindDataSource, "thcpn_legacy_mysql adapter requires mysql data source type")
	}
	db, err := r.OpenMySQL(ctx, source)
	if err != nil {
		return result, err
	}
	cfg := metrics[0].Config
	tables, err := thcpnHistoryTables(ctx, db, cfg, req.Start, req.End)
	if err != nil {
		return result, apperr.Wrap(apperr.KindDataSource, "list THCPN history partitions", err)
	}
	shards := make([]earliestShard, 0, len(tables))
	for table, spans := range tables {
		for _, span := range spans {
			shards = append(shards, earliestShard{table: table, span: span})
		}
	}
	candidates, err := findTHCPNEarliestShards(ctx, db, cfg, shards)
	if err != nil {
		return result, err
	}
	result.SourceScans = len(shards)
	for _, metric := range metrics {
		result.Series[metric.Binding.DataStreamID] = platform.TelemetryResult{Complete: true}
	}
	var best *earliestSample
	for _, shard := range candidates {
		if best != nil {
			if !shard.first.Before(best.point.Timestamp) {
				break
			}
			if best.point.Timestamp.Before(shard.span.end) {
				shard.span.end = best.point.Timestamp
			}
		}
		sample, scanned, err := readTHCPNFirstValidSample(ctx, db, metrics, shard)
		if err != nil {
			return result, err
		}
		result.RowsRead += scanned
		if sample != nil {
			best = sample
		}
	}
	if best != nil {
		result.Series[best.stream] = platform.TelemetryResult{Points: []platform.TelemetryPoint{best.point}, SourceCount: 1, Complete: true}
	}
	return result, nil
}

func earliestShardFilter(cfg thcpnLegacyBindingConfig, table string) string {
	q := platform.QuoteMySQLIdentifier
	return fmt.Sprintf(" FROM %s WHERE %s=? AND %s IS NULL AND %s=? AND %s>=? AND %s<?",
		q(table), q(cfg.DeviceIDField), q(cfg.DeletedAtField), q(cfg.TypeField), q(cfg.TimeField), q(cfg.TimeField))
}

// First check which partitions contain this device. Batching the index lookups
// avoids a separate network round trip for each empty historical partition.
func findTHCPNEarliestShards(ctx context.Context, db *sql.DB, cfg thcpnLegacyBindingConfig, shards []earliestShard) ([]earliestShard, error) {
	var candidates []earliestShard
	timeField := platform.QuoteMySQLIdentifier(cfg.TimeField)
	for chunk := range slices.Chunk(shards, 32) {
		parts := make([]string, 0, len(chunk))
		args := make([]any, 0, len(chunk)*4)
		for i, shard := range chunk {
			parts = append(parts, fmt.Sprintf("(SELECT %d, %s%s ORDER BY %s ASC LIMIT 1)", i, timeField, earliestShardFilter(cfg, shard.table), timeField))
			args = append(args, cfg.ExternalDeviceID, cfg.RowType, shard.span.start, shard.span.end)
		}
		rows, err := db.QueryContext(ctx, strings.Join(parts, " UNION ALL "), args...)
		if err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "locate earliest THCPN partitions", err)
		}
		for rows.Next() {
			var index int
			var at time.Time
			if err = rows.Scan(&index, &at); err != nil {
				rows.Close()
				return nil, apperr.Wrap(apperr.KindDataSource, "read earliest THCPN partition", err)
			}
			shard := chunk[index]
			shard.first = at
			candidates = append(candidates, shard)
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return nil, apperr.Wrap(apperr.KindDataSource, "read earliest THCPN partitions", err)
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].first.Before(candidates[j].first) })
	return candidates, nil
}

func readTHCPNFirstValidSample(ctx context.Context, db *sql.DB, metrics []thcpnBatchMetric, shard earliestShard) (*earliestSample, int, error) {
	const pageSize = 128
	cfg := metrics[0].Config
	q := platform.QuoteMySQLIdentifier
	ts, id, data := q(cfg.TimeField), q(cfg.IDField), q(cfg.DataField)
	columns := []string{ts, id, data}
	var projectionArgs []any
	custom := make([]*sql.NullString, len(metrics))
	for i, metric := range metrics {
		if !supportsTHCPNTelemetryBatch(metric.Config) {
			columns = append(columns, fmt.Sprintf("COALESCE(JSON_UNQUOTE(JSON_EXTRACT(%s, ?)), JSON_UNQUOTE(JSON_EXTRACT(%s, ?)))", data, data))
			projectionArgs = append(projectionArgs, metric.Config.ValuePath, thcpnJSONDirectPath(metric.Config.JSONKey))
			custom[i] = new(sql.NullString)
		}
	}
	query := "SELECT " + strings.Join(columns, ", ") + earliestShardFilter(cfg, shard.table)
	order := " ORDER BY " + ts + " ASC, " + id + " ASC LIMIT ?"
	var at time.Time
	var rowID int64
	var raw []byte
	fields := []any{&at, &rowID, &raw}
	for _, value := range custom {
		if value != nil {
			fields = append(fields, value)
		}
	}
	count := 0
	for {
		pageQuery := query
		args := append(slices.Clone(projectionArgs), cfg.ExternalDeviceID, cfg.RowType, shard.first, shard.span.end)
		if count > 0 {
			pageQuery += fmt.Sprintf(" AND (%s > ? OR (%s = ? AND %s > ?))", ts, ts, id)
			args = append(args, at, at, rowID)
		}
		rows, err := db.QueryContext(ctx, pageQuery+order, append(args, pageSize)...)
		if err != nil {
			return nil, count, apperr.Wrap(apperr.KindDataSource, "read earliest THCPN samples", err)
		}
		pageCount := 0
		for rows.Next() {
			if err = rows.Scan(fields...); err != nil {
				rows.Close()
				return nil, count, apperr.Wrap(apperr.KindDataSource, "scan earliest THCPN sample", err)
			}
			pageCount++
			count++
			var values map[string]json.RawMessage
			_ = json.Unmarshal(raw, &values)
			for i, metric := range metrics {
				var value float64
				var valid bool
				if custom[i] != nil {
					value, valid = parseTHCPNTelemetryValue(*custom[i])
				} else {
					value, valid = parseTHCPNBatchTelemetryValue(values[metric.Config.JSONKey])
				}
				if valid {
					rows.Close()
					return &earliestSample{metric.Binding.DataStreamID, platform.TelemetryPoint{Timestamp: at, Value: value, Quality: "valid"}}, count, nil
				}
			}
		}
		rows.Close()
		if err = rows.Err(); err != nil {
			return nil, count, apperr.Wrap(apperr.KindDataSource, "read earliest THCPN samples", err)
		}
		if pageCount < pageSize {
			return nil, count, nil
		}
	}
}
