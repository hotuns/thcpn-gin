package datasource

import (
	"context"
	"sort"
	"thcpn-gin/internal/apperr"
	"time"
)

func queryLoRaWANV2Metrics(ctx context.Context, client *loraWANV2Client, cfg loraWANV2TelemetryConfig, metrics []string, start, end time.Time, limit int, adaptive bool, target int) (map[string]TelemetryResult, int, error) {
	if limit <= 0 || !end.After(start) {
		return nil, 0, apperr.New(apperr.KindInvalidArgument, "valid time range and limit are required")
	}
	if adaptive && target < 2 {
		return nil, 0, apperr.New(apperr.KindInvalidArgument, "adaptive queries require at least two target points")
	}
	results := make(map[string]TelemetryResult, len(metrics))
	collectors := make(map[string]*thcpnAdaptiveTelemetryCollector, len(metrics))
	missing := map[string]int{}
	for _, metric := range metrics {
		results[metric] = TelemetryResult{Points: []TelemetryPoint{}}
		if adaptive {
			collectors[metric] = newTHCPNAdaptiveTelemetryCollector(start, end, target, max(2, target-2))
		}
	}
	scanLimit := limit
	if adaptive {
		scanLimit = 0
	}
	rows, complete, err := client.scanRecords(ctx, cfg, start, end, scanLimit, func(record loraWANV2Record) {
		if record.Timestamp.Before(start) || record.Timestamp.After(end) {
			return
		}
		for metric, item := range results {
			value, ok := loraWANV2Number(record.Values[metric])
			if !ok {
				missing[metric]++
				continue
			}
			point := TelemetryPoint{Timestamp: record.Timestamp, Value: value, Quality: "valid"}
			item.SourceCount++
			if adaptive {
				collectors[metric].Add(point)
			} else {
				item.Points = append(item.Points, point)
			}
			results[metric] = item
		}
	})
	if err != nil {
		return nil, rows, err
	}
	for metric, item := range results {
		item.Complete = complete
		if adaptive {
			item.Points, item.Sampled = collectors[metric].Result()
		}
		sort.SliceStable(item.Points, func(i, j int) bool { return item.Points[i].Timestamp.Before(item.Points[j].Timestamp) })
		if adaptive && len(item.Points) > target {
			points := make([]TelemetryPoint, target)
			for i := range points {
				points[i] = item.Points[i*(len(item.Points)-1)/(target-1)]
			}
			item.Points = points
			item.Sampled = true
		}
		if missing[metric] > 0 {
			item.Warnings = append(item.Warnings, QueryWarning{Code: "missing_metric", Message: "部分记录未包含有效的指标值", Count: missing[metric]})
		}
		results[metric] = item
	}
	return results, rows, nil
}
