package thcpn

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/platform/statisticstest"
)

func statisticsTime(value string) time.Time {
	t, err := time.ParseInLocation("2006-01-02 15:04:05", value, platform.LegacySourceLocation)
	if err != nil {
		panic(err)
	}
	return t
}
func TestStatisticsTHCPNCutoverCountsSourceRowsAndHistoricalImages(t *testing.T) {
	start, end := statisticsTime("2026-07-01 00:00:00"), statisticsTime("2026-07-03 00:00:00")
	cutoff := statisticsTime("2026-06-01 00:00:00")
	// Multiple metrics in data, duplicate bindings for the same image key, and
	// duplicate shard index entries must not multiply source records or images.
	db := statisticstest.New(t,
		statisticstest.Step{Contains: []string{"SELECT COALESCE(t.table_name, '')", "LEFT JOIN", "i.start_at < ?", "i.end_at >= ?"}, Args: []driver.Value{"2026-07-01 00:00:00", "2026-06-01 00:00:00"}, Columns: []string{"tb_name"}, Rows: [][]driver.Value{{"device_data_152"}, {"device_data_152"}}},
		statisticstest.Step{Contains: []string{"information_schema.tables"}, Columns: []string{"table_name"}, Rows: [][]driver.Value{{"device_data_202607"}, {"device_data_202607"}, {"device_data_202613"}, {"device_data_202606"}, {"device_data_202608"}, {"device_data_202607;DROP"}}},
		statisticstest.Step{Contains: []string{"SELECT id, data, image FROM device_config"}, Excludes: []string{"deleted_at"}, Args: []driver.Value{int64(42)}, Columns: []string{"id", "data", "image"}, Rows: [][]driver.Value{{int64(7), `[{"params":{"contents":[{"key":"temperature"},{"key":"humidity"}]}}]`, `[{"key":"cam"},{"key":"cam"}]`}}},
		statisticstest.Step{Contains: []string{"COUNT(*)", "`device_data_152`", "type = 'data'", "deleted_at IS NULL", "ts IS NOT NULL", "ts >= ? AND ts < ?"}, Excludes: []string{"DISTINCT", "JSON_EXTRACT", "JOIN", "ts <="}, Args: []driver.Value{"2026-07-01 00:00:00", int64(42), "2026-06-01 00:00:00", "2026-07-01 00:00:00"}, Columns: []string{"day", "count", "first", "last"}, Rows: [][]driver.Value{{"", int64(2), "2026-06-30 23:59:59.000000", "2026-06-30 23:59:59.000000"}}},
		statisticstest.Step{Contains: []string{"SUM(image_count)", "CASE device_config_id", "type = 'image'", "`device_data_152`"}, Args: []driver.Value{"2026-07-01 00:00:00", int64(7), `$."cam".value`, `$."cam".value`, `$."cam"`, `$."cam"`, int64(42), "2026-06-01 00:00:00", "2026-07-01 00:00:00"}, Columns: []string{"day", "images", "unknown"}, Rows: [][]driver.Value{{"", int64(1), int64(1)}}},
		statisticstest.Step{Contains: []string{"COUNT(*)", "`device_data_202607`", "ts >= ? AND ts < ?"}, Excludes: []string{"DISTINCT", "JSON_EXTRACT", "JOIN"}, Args: []driver.Value{"2026-07-01 00:00:00", int64(42), "2026-07-01 00:00:00", "2026-07-03 00:00:00"}, Columns: []string{"day", "count", "first", "last"}, Rows: [][]driver.Value{{"2026-07-01", int64(3), "2026-07-01 00:00:00.000000", "2026-07-01 23:59:59.000000"}}},
		statisticstest.Step{Contains: []string{"SUM(image_count)", "`device_data_202607`"}, Columns: []string{"day", "images", "unknown"}, Rows: [][]driver.Value{{"2026-07-01", int64(2), int64(0)}}},
	)
	result, err := readTHCPNStatistics(t.Context(), db, "source/thcpn/42", 42, thcpnShardStrategyCutover, &cutoff, start.UTC(), end.UTC())
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalRecords == nil || *result.TotalRecords != 5 {
		t.Fatalf("records=%v", result.TotalRecords)
	}
	if len(result.Days) != 2 || result.Days[0].Date != "2026-07-01" || *result.Days[0].Records != 3 || *result.Days[1].Records != 0 {
		t.Fatalf("days=%+v", result.Days)
	}
	if result.TotalImages != nil || result.Days[0].Images == nil || *result.Days[0].Images != 2 || *result.Days[1].Images != 0 {
		t.Fatalf("image completeness=%+v", result)
	}
	if !result.FirstObservedAt.Equal(statisticsTime("2026-06-30 23:59:59")) || !result.LastObservedAt.Equal(statisticsTime("2026-07-01 23:59:59")) {
		t.Fatalf("extrema=%+v", result)
	}
}

func TestStatisticsTHCPNIndexUnlimitedAndValidated(t *testing.T) {
	rows := [][]driver.Value{}
	for i := 1; i <= 12; i++ {
		rows = append(rows, []driver.Value{fmt.Sprintf("device_data_%d", i)})
	}
	db := statisticstest.New(t, statisticstest.Step{Contains: []string{"device_data_index"}, Columns: []string{"tb_name"}, Rows: rows})
	got, err := thcpnStatisticsTables(t.Context(), db, thcpnShardStrategyIndex, statisticsTime("2025-01-01 00:00:00"), statisticsTime("2026-08-01 00:00:00"))
	if err != nil || len(got) != 12 {
		t.Fatalf("tables=%d err=%v", len(got), err)
	}
	bad := statisticstest.New(t, statisticstest.Step{Columns: []string{"tb_name"}, Rows: [][]driver.Value{{"device_data_1`; DROP TABLE devices"}}})
	if _, err := thcpnStatisticsTables(t.Context(), bad, thcpnShardStrategyIndex, statisticsTime("2025-01-01 00:00:00"), statisticsTime("2026-08-01 00:00:00")); err == nil {
		t.Fatal("accepted injected identifier")
	}
}

func TestStatisticsTHCPNMissingIndexedTableIsFailure(t *testing.T) {
	db := statisticstest.New(t, statisticstest.Step{Contains: []string{"LEFT JOIN"}, Columns: []string{"table"}, Rows: [][]driver.Value{{""}}})
	_, err := thcpnStatisticsTables(t.Context(), db, thcpnShardStrategyIndex, statisticsTime("2025-01-01 00:00:00"), statisticsTime("2026-08-01 00:00:00"))
	if err == nil {
		t.Fatal("missing indexed source table became empty history")
	}
}

func TestStatisticsTHCPNFailureDoesNotBecomeZero(t *testing.T) {
	db := statisticstest.New(t, statisticstest.Step{Err: errors.New("password@private-host:3306")})
	result, err := readTHCPNStatistics(t.Context(), db, "source", 42, thcpnShardStrategyIndex, nil, statisticsTime("2026-07-01 00:00:00"), statisticsTime("2026-07-03 00:00:00"))
	if err == nil || strings.Contains(err.Error(), "private-host") || result.TotalRecords != nil {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}

func TestStatisticsTHCPNImageKeysDeduplicateLegacyAndModern(t *testing.T) {
	db := statisticstest.New(t, statisticstest.Step{Columns: []string{"id", "data", "image"}, Rows: [][]driver.Value{
		{int64(7), `{"camera":{"type":"image"},"temperature":{"type":"number"}}`, `[{"key":"camera"},{"key":"other"},{"key":"other"}]`},
		{int64(8), `invalid`, nil},
	}})
	expression, args, err := thcpnStatisticsImageExpression(t.Context(), db, 42)
	if err != nil || len(args) != 17 || strings.Count(expression, "THEN 1 ELSE 0 END") != 2 || strings.Count(expression, "<=>") != 1 || !strings.Contains(expression, "ELSE NULL END") {
		t.Fatalf("expression=%s args=%v err=%v", expression, args, err)
	}
}
