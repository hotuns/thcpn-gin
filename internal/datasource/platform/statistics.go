package platform

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"thcpn-gin/internal/apperr"
)

// ObservationStatistics counts source rows, never projected metrics. Nil means
// unsupported/unknown; a non-nil zero means the source was queried successfully.
// Totals and extrema cover formal observations before end, while Days covers
// [start,end) in Asia/Shanghai. Images count references, not image rows.
type ObservationStatistics struct {
	Identity                string           `json:"identity"`
	TotalRecords            *int64           `json:"total_records"`
	TotalImages             *int64           `json:"total_images"`
	Days                    []ObservationDay `json:"days"`
	FirstObservedAt         *time.Time       `json:"first_observed_at"`
	LastObservedAt          *time.Time       `json:"last_observed_at"`
	ExpectedIntervalSeconds *int64           `json:"expected_interval_seconds"`
	Excluded                bool             `json:"excluded"`
}
type ObservationDay struct {
	Date    string `json:"date"`
	Records *int64 `json:"records"`
	Images  *int64 `json:"images"`
}

func ObservationIdentity(source uuid.UUID, family, key string) string {
	return source.String() + "/" + family + "/" + key
}

// StatisticsSourceError intentionally drops the underlying driver's message:
// MySQL/HTTP errors can contain credentials, hosts or connection strings.
func StatisticsSourceError() error {
	return apperr.New(apperr.KindDataSource, "observation statistics source unavailable")
}

// StatisticsConnection pins an explicit numeric session offset, which supports
// TIMESTAMP as well as Beijing wall-clock DATETIME without MySQL timezone tables.
// Restore pooled connection state, or discard the connection if restoration fails.
func StatisticsConnection(ctx context.Context, db *sql.DB) (*sql.Conn, func(), error) {
	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, nil, StatisticsSourceError()
	}
	var previous string
	if err = conn.QueryRowContext(ctx, "SELECT @@session.time_zone").Scan(&previous); err != nil {
		conn.Close()
		return nil, nil, StatisticsSourceError()
	}
	if _, err = conn.ExecContext(ctx, "SET SESSION time_zone = '+08:00'"); err != nil {
		conn.Close()
		return nil, nil, StatisticsSourceError()
	}
	cleanup := func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if _, err := conn.ExecContext(cleanupCtx, "SET SESSION time_zone = ?", previous); err != nil {
			_ = conn.Raw(func(any) error { return driver.ErrBadConn })
		}
		_ = conn.Close()
	}
	return conn, cleanup, nil
}

type StatisticsQuerier interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

// RecordStatistics collects at most one pre-window bucket plus daily window
// buckets per table. Raw payloads are never transferred or counted per metric.
type RecordStatistics struct {
	result ObservationStatistics
	days   map[string]int
}

func NewRecordStatistics(identity string, start, end time.Time) *RecordStatistics {
	zero := int64(0)
	out := &RecordStatistics{result: ObservationStatistics{Identity: identity, TotalRecords: &zero, Days: []ObservationDay{}}, days: map[string]int{}}
	start = start.In(LegacySourceLocation)
	day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, LegacySourceLocation)
	for ; day.Before(end); day = day.AddDate(0, 0, 1) {
		count := int64(0)
		date := day.Format("2006-01-02")
		out.days[date] = len(out.result.Days)
		out.result.Days = append(out.result.Days, ObservationDay{Date: date, Records: &count})
	}
	return out
}
func (s *RecordStatistics) Result() ObservationStatistics { return s.result }

// AddTable expects a trusted, source-owned predicate and bound arguments. Table
// identifiers are validated even when callers already filtered the catalog.
func (s *RecordStatistics) AddTable(ctx context.Context, db StatisticsQuerier, table, predicate string, args []any, start time.Time) error {
	if _, err := RequiredIdentifier(table, "statistics table"); err != nil {
		return StatisticsSourceError()
	}
	query := "SELECT CASE WHEN ts >= ? THEN DATE_FORMAT(ts, '%Y-%m-%d') ELSE '' END AS day, COUNT(*), DATE_FORMAT(MIN(ts), '%Y-%m-%d %H:%i:%s.%f'), DATE_FORMAT(MAX(ts), '%Y-%m-%d %H:%i:%s.%f') FROM " + QuoteMySQLIdentifier(table) + " WHERE " + predicate + " GROUP BY day"
	queryArgs := append([]any{StatisticsWallTime(start)}, args...)
	rows, err := db.QueryContext(ctx, query, queryArgs...)
	if err != nil {
		return StatisticsSourceError()
	}
	defer rows.Close()
	for rows.Next() {
		var day, first, last string
		var count int64
		if err := rows.Scan(&day, &count, &first, &last); err != nil || count < 0 {
			return StatisticsSourceError()
		}
		min, err := time.ParseInLocation("2006-01-02 15:04:05.999999", first, LegacySourceLocation)
		if err != nil {
			return StatisticsSourceError()
		}
		max, err := time.ParseInLocation("2006-01-02 15:04:05.999999", last, LegacySourceLocation)
		if err != nil {
			return StatisticsSourceError()
		}
		*s.result.TotalRecords += count
		if day != "" {
			index, ok := s.days[day]
			if !ok {
				return StatisticsSourceError()
			}
			*s.result.Days[index].Records += count
		}
		if s.result.FirstObservedAt == nil || min.Before(*s.result.FirstObservedAt) {
			s.result.FirstObservedAt = &min
		}
		if s.result.LastObservedAt == nil || max.After(*s.result.LastObservedAt) {
			s.result.LastObservedAt = &max
		}
	}
	if rows.Err() != nil {
		return StatisticsSourceError()
	}
	return nil
}

func StatisticsWallTime(t time.Time) string {
	return t.In(LegacySourceLocation).Format("2006-01-02 15:04:05.999999")
}
func StatisticsLowerBound(cutoff *time.Time) time.Time {
	// MySQL's earliest valid DATETIME; excludes NULL/zero dates as well.
	lower := time.Date(1000, 1, 1, 0, 0, 0, 0, LegacySourceLocation)
	if cutoff != nil && cutoff.After(lower) {
		lower = *cutoff
	}
	return lower
}

// StatisticsInterval only trusts explicit, uniform full-day capture AND upload
// plans. It does not apply presets or infer a schedule from source timestamps.
func StatisticsInterval(control json.RawMessage) *int64 {
	var fields map[string]any
	if json.Unmarshal(control, &fields) != nil {
		return nil
	}
	capture, cok := fields["data_capture_invl"].(string)
	upload, uok := fields["data_upload_invl"].(string)
	if !cok || !uok {
		return nil
	}
	a, b := statisticsScheduleInterval(capture), statisticsScheduleInterval(upload)
	if a == nil || b == nil {
		return nil
	}
	if *b > *a {
		return b
	}
	return a
}
func statisticsScheduleInterval(cron string) *int64 {
	minutes, hours, ok := ParseTwoFieldSchedule(strings.TrimSpace(cron))
	if !ok {
		return nil
	}
	hours = ExpandWildcardHours(hours)
	// Requiring every hour deliberately leaves day-only and sparse-hour plans
	// unknown, even when their within-day gaps happen to be equal.
	if len(hours) != 24 || len(minutes) == 0 {
		return nil
	}
	seenHours := map[int]bool{}
	for _, h := range hours {
		if h < 0 || h > 23 || seenHours[h] {
			return nil
		}
		seenHours[h] = true
	}
	minutes = append([]int(nil), minutes...)
	sort.Ints(minutes)
	gap := 60 / len(minutes)
	if gap*len(minutes) != 60 {
		return nil
	}
	for i, m := range minutes {
		if m < 0 || m > 59 || (minutes[(i+1)%len(minutes)]-m+60)%60 != gap%60 {
			return nil
		}
	}
	seconds := int64(gap * 60)
	return &seconds
}

// StatisticsMonthlyTable validates a canonical YYYYMM suffix, with no SQL
// wildcard interpretation or acceptance of similarly named derived tables.
func StatisticsMonthlyTable(table, prefix string) (time.Time, bool) {
	if !strings.HasPrefix(table, prefix) {
		return time.Time{}, false
	}
	suffix := strings.TrimPrefix(table, prefix)
	if len(suffix) != 6 {
		return time.Time{}, false
	}
	month, err := time.ParseInLocation("200601", suffix, LegacySourceLocation)
	return month, err == nil && fmt.Sprintf("%04d%02d", month.Year(), month.Month()) == suffix
}
