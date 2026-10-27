package export

import (
	"context"
	"sort"
	"time"

	"thcpn-gin/internal/apperr"
	platform "thcpn-gin/internal/datasource/platform"
)

const exportQueryWindow = 30 * 24 * time.Hour
const maxExportTelemetryPoints = 10_000_000

// Adjacent queries share their inclusive endpoint. Merge readers deduplicate that
// endpoint rather than subtracting time precision that differs between sources.
func forExportWindows(ctx context.Context, start, end time.Time, read func(time.Time, time.Time) error) error {
	if !end.After(start) {
		return apperr.New(apperr.KindInvalidArgument, "end_time must be after start_time")
	}
	for cursor := start; cursor.Before(end); {
		if err := ctx.Err(); err != nil {
			return err
		}
		next := cursor.Add(exportQueryWindow)
		if next.After(end) {
			next = end
		}
		if err := read(cursor, next); err != nil {
			return err
		}
		cursor = next
	}
	return nil
}

func (p *Processor) queryExportTelemetry(ctx context.Context, source platform.DataSource, req platform.TelemetryQuery) ([]platform.TelemetryPoint, error) {
	var points []platform.TelemetryPoint
	previousBoundary := map[platform.TelemetryPoint]struct{}{}
	err := forExportWindows(ctx, req.Start, req.End, func(start, end time.Time) error {
		part := req
		part.Start = start
		part.End = end
		if part.Limit <= 0 {
			part.Limit = 100000
		}
		var result platform.TelemetryResult
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			var err error
			result, err = p.runtime.QueryTelemetry(ctx, source, part)
			if err != nil {
				return err
			}
			if result.Complete && !result.Sampled {
				break
			}
			if part.Limit >= maxExportTelemetryPoints {
				return apperr.New(apperr.KindDataSource, "遥测数据量超出单次导出上限，请缩短时间范围后重试")
			}
			part.Limit *= 2
			if part.Limit > maxExportTelemetryPoints {
				part.Limit = maxExportTelemetryPoints
			}
		}
		boundary := map[platform.TelemetryPoint]struct{}{}
		for _, point := range result.Points {
			key := point
			key.Timestamp = point.Timestamp.UTC()
			if point.Timestamp.Equal(start) {
				if _, seen := previousBoundary[key]; seen {
					continue
				}
			}
			if point.Timestamp.Equal(end) {
				boundary[key] = struct{}{}
			}
			points = append(points, point)
			if len(points) > maxExportTelemetryPoints {
				return apperr.New(apperr.KindDataSource, "遥测数据量超出单次导出上限，请缩短时间范围后重试")
			}
		}
		previousBoundary = boundary
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.SliceStable(points, func(i, j int) bool { return points[i].Timestamp.Before(points[j].Timestamp) })
	return points, nil
}

func (p *Processor) queryExportMedia(ctx context.Context, source platform.DataSource, req platform.MediaQuery) ([]platform.MediaRecord, error) {
	var records []platform.MediaRecord
	type identity struct {
		id, key string
		ts      time.Time
	}
	previousBoundary := map[identity]struct{}{}
	err := forExportWindows(ctx, req.Start, req.End, func(start, end time.Time) error {
		part := req
		part.Start = start
		part.End = end
		part.Page = 1
		if part.PageSize <= 0 {
			part.PageSize = 100000
		}
		count := 0
		boundary := map[identity]struct{}{}
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			result, err := p.runtime.QueryMedia(ctx, source, part)
			if err != nil {
				return err
			}
			for _, record := range result.Items {
				key := identity{record.ID, record.ObjectKey, record.CapturedAt.UTC()}
				if record.CapturedAt.Equal(start) {
					if _, seen := previousBoundary[key]; seen {
						continue
					}
				}
				if record.CapturedAt.Equal(end) {
					boundary[key] = struct{}{}
				}
				records = append(records, record)
			}
			count += len(result.Items)
			if len(result.Items) == 0 || count >= result.Total || len(result.Items) < part.PageSize {
				break
			}
			part.Page++
		}
		previousBoundary = boundary
		return nil
	})
	if err != nil {
		return nil, err
	}
	return records, nil
}

func validateBatchReadResults(rows []qualityReportRow) error {
	failed, packed := false, 0
	for _, row := range rows {
		if row.Status == "missing" {
			failed = true
		}
		if row.Status == "packed" {
			packed += row.Count
		}
	}
	if failed && packed == 0 {
		return apperr.New(apperr.KindDataSource, "导出未生成任何数据或图片：读取数据源或下载图片失败，请稍后重试；如持续失败，请联系管理员")
	}
	return nil
}
