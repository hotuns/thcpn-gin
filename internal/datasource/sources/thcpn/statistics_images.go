package thcpn

import (
	"context"
	"sort"
	"strings"
	"time"

	"thcpn-gin/internal/datasource/platform"
)

// Historical rows carry device_config_id. Resolve keys from that configuration,
// including soft-deleted configurations, rather than today's active bindings.
// This uses MySQL 5.7 JSON functions, not version-dependent JSON_TABLE.
func thcpnStatisticsImageExpression(ctx context.Context, db platform.StatisticsQuerier, id int64) (string, []any, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, data, image FROM device_config WHERE device_id=? ORDER BY id", id)
	if err != nil {
		return "", nil, platform.StatisticsSourceError()
	}
	defer rows.Close()
	clauses := []string{}
	args := []any{}
	for rows.Next() {
		var configID int64
		var data, image []byte
		if rows.Scan(&configID, &data, &image) != nil {
			return "", nil, platform.StatisticsSourceError()
		}
		specs, err := buildTHCPNStreamSpecs(id, data, image)
		if err != nil {
			continue
		} // Unknown configuration: expression remains NULL.
		seen := map[string]bool{}
		for _, spec := range specs {
			if spec.Type == "image" && spec.JSONKey != "" {
				seen[spec.JSONKey] = true
			}
		}
		keys := make([]string, 0, len(seen))
		for key := range seen {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		// An image row with no declared image keys is not evidence of zero images.
		if len(keys) == 0 {
			continue
		}
		expression, referenceArgs := thcpnStatisticsUniqueImageCount(keys)
		args = append(args, configID)
		args = append(args, referenceArgs...)
		clauses = append(clauses, "WHEN ? THEN ("+expression+")")
	}
	if rows.Err() != nil {
		return "", nil, platform.StatisticsSourceError()
	}
	if len(clauses) == 0 {
		return "NULL", nil, nil
	}
	return "CASE device_config_id " + strings.Join(clauses, " ") + " ELSE NULL END", args, nil
}

// Count a normalized reference only at its first key in this source row. Binary
// null-safe comparisons preserve case-sensitive object keys and do not let an
// absent earlier key hide a later valid image. This stays within MySQL 5.7 SQL.
func thcpnStatisticsUniqueImageCount(keys []string) (string, []any) {
	expressions := make([]string, 0, len(keys))
	args := []any{}
	references := make([]string, 0, len(keys))
	referenceArgs := make([][]any, 0, len(keys))
	for i, key := range keys {
		nested, direct := thcpnJSONValuePath(key), thcpnJSONDirectPath(key)
		// Match media URL construction: trim surrounding spaces and leading slashes.
		value := "NULLIF(NULLIF(TRIM(LEADING '/' FROM TRIM(JSON_UNQUOTE(JSON_EXTRACT(data, ?)))), ''), 'null')"
		reference := "CASE WHEN JSON_TYPE(JSON_EXTRACT(data, ?)) = 'STRING' THEN " + value + " WHEN JSON_TYPE(JSON_EXTRACT(data, ?)) = 'STRING' THEN " + value + " ELSE NULL END"
		paths := []any{nested, nested, direct, direct}
		references = append(references, reference)
		referenceArgs = append(referenceArgs, paths)
		conditions := []string{"(" + reference + ") IS NOT NULL"}
		args = append(args, paths...)
		for j := 0; j < i; j++ {
			conditions = append(conditions, "NOT (CAST(("+reference+") AS BINARY) <=> CAST(("+references[j]+") AS BINARY))")
			args = append(args, paths...)
			args = append(args, referenceArgs[j]...)
		}
		expressions = append(expressions, "CASE WHEN "+strings.Join(conditions, " AND ")+" THEN 1 ELSE 0 END")
	}
	return strings.Join(expressions, " + "), args
}

func initializeTHCPNImageCounts(result *platform.ObservationStatistics) {
	zero := int64(0)
	result.TotalImages = &zero
	for i := range result.Days {
		count := int64(0)
		result.Days[i].Images = &count
	}
}
func addTHCPNImageStatistics(ctx context.Context, db platform.StatisticsQuerier, result *platform.ObservationStatistics, table, predicate string, filterArgs []any, expression string, expressionArgs []any, start time.Time) error {
	if validateTHCPNShardTableName(table) != nil {
		return platform.StatisticsSourceError()
	}
	query := "SELECT CASE WHEN ts >= ? THEN DATE_FORMAT(ts, '%Y-%m-%d') ELSE '' END AS day, COALESCE(SUM(image_count), 0), SUM(CASE WHEN image_count IS NULL THEN 1 ELSE 0 END) FROM (SELECT ts, " + expression + " AS image_count FROM " + platform.QuoteMySQLIdentifier(table) + " WHERE " + predicate + ") images GROUP BY day"
	args := append([]any{platform.StatisticsWallTime(start)}, expressionArgs...)
	args = append(args, filterArgs...)
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return platform.StatisticsSourceError()
	}
	defer rows.Close()
	for rows.Next() {
		var day string
		var count, unknown int64
		if rows.Scan(&day, &count, &unknown) != nil || count < 0 || unknown < 0 {
			return platform.StatisticsSourceError()
		}
		if unknown > 0 {
			result.TotalImages = nil
		} else if result.TotalImages != nil {
			*result.TotalImages += count
		}
		if day == "" {
			continue
		}
		found := false
		for i := range result.Days {
			bucket := &result.Days[i]
			if bucket.Date != day {
				continue
			}
			found = true
			if unknown > 0 {
				bucket.Images = nil
			} else if bucket.Images != nil {
				*bucket.Images += count
			}
			break
		}
		if !found {
			return platform.StatisticsSourceError()
		}
	}
	if rows.Err() != nil {
		return platform.StatisticsSourceError()
	}
	return nil
}
