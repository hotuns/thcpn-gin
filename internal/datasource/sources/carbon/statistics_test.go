package carbon

import (
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"thcpn-gin/internal/datasource/platform"
	"thcpn-gin/internal/datasource/platform/statisticstest"
)

func TestStatisticsCarbonCanonicalTablesAndNodeCutoffs(t *testing.T) {
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, platform.LegacySourceLocation)
	end := start.AddDate(0, 0, 2)
	cutoff := start.AddDate(0, -1, 0)
	nodeCutoff := start.Add(time.Hour)
	db := statisticstest.New(t,
		statisticstest.Step{Contains: []string{"information_schema.tables"}, Args: []driver.Value{carbonDatabaseName}, Columns: []string{"table_name"}, Rows: [][]driver.Value{{"device_data_202610"}, {"carbon_flux_202610"}, {"device_data_next_202610"}, {"device_data_next_202610"}, {"device_data_next_202613"}, {"device_data_next_202610_old"}}},
		statisticstest.Step{Contains: []string{"COUNT(*)", "`device_data_next_202610`", "type = 'data'", "deleted_at IS NULL", "ts < ?", "ts >= CASE node_id WHEN ? THEN ? ELSE ? END"}, Excludes: []string{"DISTINCT", "JSON_EXTRACT", "JOIN", "ts <="}, Args: []driver.Value{"2026-10-01 00:00:00", int64(7), "2026-10-03 00:00:00", int64(2), "2026-10-01 01:00:00", "2026-09-01 00:00:00"}, Columns: []string{"day", "count", "first", "last"}, Rows: [][]driver.Value{{"", int64(4), "2026-09-30 00:00:00.000000", "2026-09-30 00:00:00.000000"}, {"2026-10-01", int64(3), "2026-10-01 00:00:00.000000", "2026-10-01 01:00:00.000000"}}},
	)
	result, err := readCarbonStatistics(t.Context(), db, "source/carbon/7", 7, &cutoff, map[int]time.Time{2: nodeCutoff}, start.UTC(), end.UTC())
	if err != nil {
		t.Fatal(err)
	}
	if result.TotalRecords == nil || *result.TotalRecords != 7 || len(result.Days) != 2 || *result.Days[0].Records != 3 || *result.Days[1].Records != 0 {
		t.Fatalf("result=%+v", result)
	}
	if result.TotalImages != nil || result.Days[0].Images != nil || result.ExpectedIntervalSeconds != nil {
		t.Fatalf("unsupported fields became known: %+v", result)
	}
}

func TestStatisticsCarbonQueryFailureIsNotZero(t *testing.T) {
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, platform.LegacySourceLocation)
	db := statisticstest.New(t,
		statisticstest.Step{Columns: []string{"table_name"}, Rows: [][]driver.Value{{"device_data_next_202610"}}},
		statisticstest.Step{Err: errors.New("user:password@secret-host")},
	)
	result, err := readCarbonStatistics(t.Context(), db, "source", 7, nil, nil, start, start.AddDate(0, 0, 1))
	if err == nil || result.TotalRecords != nil || strings.Contains(err.Error(), "secret-host") {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
