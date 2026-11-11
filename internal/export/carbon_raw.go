package export

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"thcpn-gin/internal/apperr"
	"thcpn-gin/internal/datasource/sources/carbon"
	"thcpn-gin/internal/systemsettings"
)

type carbonRawExportSource interface {
	CarbonRawPeriods(context.Context, uuid.UUID, int, time.Time, time.Time) ([]carbon.CarbonPeriodSummary, error)
	CarbonRawPeriodSamples(context.Context, uuid.UUID, int, string, carbon.CarbonPeriodSummary) ([]carbon.CarbonRawPhase, error)
}

// Discover only distinct period references, once per node for all selected fields.
// A fixed upper bound also applies when the general export window is configured longer.
func carbonExportPeriods(ctx context.Context, source carbonRawExportSource, id uuid.UUID, node int, start, end time.Time) ([]carbon.CarbonPeriodSummary, error) {
	if !end.After(start) {
		return nil, apperr.New(apperr.KindInvalidArgument, "结束时间必须晚于开始时间")
	}
	byPeriod := map[string]carbon.CarbonPeriodSummary{}
	window := time.Duration(min(7, systemsettings.Int(ctx, "export_window_days", 7))) * 24 * time.Hour
	for cursor := start; cursor.Before(end); {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		next := cursor.Add(window)
		if next.After(end) {
			next = end
		}
		periods, err := source.CarbonRawPeriods(ctx, id, node, cursor, next)
		if err != nil {
			return nil, err
		}
		for _, period := range periods {
			existing, found := byPeriod[period.Period]
			if !found {
				existing = period
				existing.Fields = nil
			}
			if period.PeriodAt.After(existing.PeriodAt) {
				existing.PeriodAt = period.PeriodAt
			}
			for _, field := range period.Fields {
				if !carbonPeriodHasField(existing, field) {
					existing.Fields = append(existing.Fields, field)
				}
			}
			byPeriod[period.Period] = existing
		}
		cursor = next
	}
	periods := make([]carbon.CarbonPeriodSummary, 0, len(byPeriod))
	for _, period := range byPeriod {
		periods = append(periods, period)
	}
	sort.Slice(periods, func(i, j int) bool {
		if !periods[i].PeriodAt.Equal(periods[j].PeriodAt) {
			return periods[i].PeriodAt.Before(periods[j].PeriodAt)
		}
		return periods[i].Period < periods[j].Period
	})
	return periods, nil
}

func carbonPeriodHasField(period carbon.CarbonPeriodSummary, field string) bool {
	for _, candidate := range period.Fields {
		if strings.EqualFold(strings.TrimSpace(candidate), strings.TrimSpace(field)) {
			return true
		}
	}
	return false
}

// Write one period at a time straight into the ZIP entry; MaxRows is a query page
// size, not permission to silently truncate a year of raw samples.
func writeCarbonRawCSV(ctx context.Context, output io.Writer, source carbonRawExportSource, id uuid.UUID, assetNo string, node int, field string, periods []carbon.CarbonPeriodSummary, extra ...exportCSVColumn) (int, error) {
	writer := csv.NewWriter(output)
	header := []string{"asset_no", "node_id", "period", "period_at", "field", "room", "ts", "CO2", "tempL", "humiL", "tempB", "humiB", "stemp", "shumi"}
	for _, column := range extra {
		header = append(header, column.name)
	}
	if err := writer.Write(header); err != nil {
		return 0, err
	}
	count := 0
	maximum := systemsettings.Int(ctx, "export_points", maxExportTelemetryPoints)
	for _, period := range periods {
		if err := ctx.Err(); err != nil {
			return count, err
		}
		if !carbonPeriodHasField(period, field) {
			continue
		}
		phases, err := source.CarbonRawPeriodSamples(ctx, id, node, field, period)
		if err != nil {
			return count, err
		}
		for _, phase := range phases {
			for _, sample := range phase.Points {
				if count >= maximum {
					return count, apperr.New(apperr.KindDataSource, fmt.Sprintf("碳汇原始采样每个节点、地块最多导出 %d 条；请缩短时间范围后分批导出", maximum))
				}
				row := []string{assetNo, strconv.Itoa(node), period.Period, exportTime(period.PeriodAt), field, phase.Room,
					exportTime(sample.TS), carbonFloat(sample.CO2), carbonFloat(sample.TempL), carbonFloat(sample.HumiL),
					carbonFloat(sample.TempB), carbonFloat(sample.HumiB), carbonFloat(sample.STemp), carbonFloat(sample.SHumi)}
				for _, column := range extra {
					row = append(row, column.value)
				}
				if err := writer.Write(row); err != nil {
					return count, err
				}
				count++
			}
		}
		writer.Flush()
		if err := writer.Error(); err != nil {
			return count, err
		}
	}
	writer.Flush()
	return count, writer.Error()
}
