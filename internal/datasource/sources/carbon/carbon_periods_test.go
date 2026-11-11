package carbon

import (
	"context"
	"database/sql/driver"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/platform/statisticstest"
)

func TestCarbonPeriodDiscoveryQueriesDistinctShardsAndMerges(t *testing.T) {
	start := time.Date(2024, 9, 1, 0, 0, 0, 0, CarbonLocation)
	end := start.AddDate(1, 0, 0)
	at := start.Add(time.Hour)
	newer := at.AddDate(0, 1, 0)
	tables := []string{"device_data_next_202409", "device_data_next_202410"}
	step := func(table string, rows [][]driver.Value) statisticstest.Step {
		return statisticstest.Step{
			Contains: []string{"SELECT DISTINCT period, period_at, field", "`" + table + "`", "type='data'", "deleted_at IS NULL", "period_at>=?", "period_at<=?"},
			Excludes: []string{"UNION", "ORDER BY", "ts,", "data FROM"},
			Args:     []driver.Value{int64(13), int64(1), start, end},
			Columns:  []string{"period", "period_at", "field"}, Rows: rows,
		}
	}
	db := statisticstest.New(t,
		step(tables[0], [][]driver.Value{
			{"old", at, "B"}, {"old", at, " A "}, {"old", at, "A"},
			{"same-time-b", newer, "D"},
		}),
		step(tables[1], [][]driver.Value{
			{"old", at, "A"}, {"old", at, "C"},
			{"same-time-a", newer, "B"},
		}),
	)
	got, err := queryCarbonPeriodSummaries(t.Context(), db, tables, 13, 1, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Period != "same-time-a" || got[1].Period != "same-time-b" || got[2].Period != "old" {
		t.Fatalf("periods not globally deduplicated and ordered: %+v", got)
	}
	fields := got[2].Fields
	if len(fields) != 3 || fields[0] != "A" || fields[1] != "B" || fields[2] != "C" || got[2].NodeID != 1 || !got[2].PeriodAt.Equal(at) {
		t.Fatalf("period lost field/time/node identity: %+v", got[2])
	}
}

func TestCarbonRawSourceErrorsAreClearAndPreserveCause(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"read timeout", os.ErrDeadlineExceeded, "碳汇原始数据查询超时"},
		{"query deadline", context.DeadlineExceeded, "碳汇原始数据查询超时"},
		{"invalid connection", mysql.ErrInvalidConn, "碳汇原始数据查询连接中断"},
		{"canceled query", context.Canceled, "碳汇原始数据查询已取消"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, raw := range []bool{false, true} {
				db := statisticstest.New(t, statisticstest.Step{Err: tc.err})
				var err error
				if raw {
					_, err = queryCarbonRawPhases(t.Context(), db, []string{"device_data_next_202409"}, 13, 1, "A", "historical")
				} else {
					_, err = queryCarbonPeriodSummaries(t.Context(), db, []string{"device_data_next_202409"}, 13, 1, time.Now().Add(-time.Hour), time.Now())
				}
				if !errors.Is(err, tc.err) || apperr.MessageOf(err) != tc.want || strings.Contains(apperr.MessageOf(err), tc.err.Error()) {
					t.Fatalf("raw=%v lost clear message/cause: %v", raw, err)
				}
			}
		})
	}
}

func TestCarbonPeriodReadFailureDoesNotReturnPartialResults(t *testing.T) {
	at := time.Date(2024, 9, 1, 0, 0, 0, 0, CarbonLocation)
	db := statisticstest.New(t,
		statisticstest.Step{Columns: []string{"period", "period_at", "field"}, Rows: [][]driver.Value{{"first", at, "A"}}},
		statisticstest.Step{Err: os.ErrDeadlineExceeded},
	)
	got, err := queryCarbonPeriodSummaries(t.Context(), db, []string{"device_data_next_202409", "device_data_next_202410"}, 13, 1, at, at.AddDate(1, 0, 0))
	if got != nil || apperr.MessageOf(err) != "碳汇原始数据查询超时" {
		t.Fatalf("partial discovery must fail instead of exporting incomplete data: %+v %v", got, err)
	}
}

func TestCarbonReadDeadlinePreservesCauseWhenDriverOnlyReturnsInvalidConnection(t *testing.T) {
	ctx, cancel := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
	defer cancel()
	err := carbonRawQueryError(ctx, mysql.ErrInvalidConn, "查询碳汇原始采样周期失败")
	if apperr.MessageOf(err) != "碳汇原始数据查询超时" || !errors.Is(err, mysql.ErrInvalidConn) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("known read deadline was lost: %v", err)
	}
	canceled, cancelRead := context.WithCancel(t.Context())
	cancelRead()
	err = carbonRawQueryError(canceled, mysql.ErrInvalidConn, "查询碳汇原始采样周期失败")
	if apperr.MessageOf(err) != "碳汇原始数据查询已取消" || !errors.Is(err, context.Canceled) || !errors.Is(err, mysql.ErrInvalidConn) {
		t.Fatalf("cancellation was reported as timeout or connection failure: %v", err)
	}
}

func TestCarbonFluxFieldDiscoveryQueriesShardsSeparately(t *testing.T) {
	start := time.Date(2024, 9, 1, 0, 0, 0, 0, CarbonLocation)
	end := start.AddDate(1, 0, 0)
	db := statisticstest.New(t,
		statisticstest.Step{Contains: []string{"SELECT DISTINCT period, data FROM `carbon_flux_202409`"}, Excludes: []string{"UNION", "ORDER BY"},
			Columns: []string{"period", "data"}, Rows: [][]driver.Value{{"period", []byte(`[{"field":"B"},{"field":"A"}]`)}}},
		statisticstest.Step{Contains: []string{"SELECT DISTINCT period, data FROM `carbon_flux_202410`"}, Excludes: []string{"UNION", "ORDER BY"},
			Columns: []string{"period", "data"}, Rows: [][]driver.Value{{"period", []byte(`[{"field":"A"},{"field":"C"}]`)}}},
	)
	got, err := queryCarbonFluxFields(t.Context(), db, []string{"carbon_flux_202409", "carbon_flux_202410"}, 13, 1, start, end)
	if err != nil {
		t.Fatal(err)
	}
	if len(got["period"]) != 3 || got["period"][0] != "A" || got["period"][1] != "B" || got["period"][2] != "C" {
		t.Fatalf("flux fields not globally deduplicated and ordered: %+v", got)
	}
}
