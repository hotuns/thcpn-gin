package export

import "time"

var exportLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// Human-readable spreadsheet cells; retain fractional precision without a
// trailing UTC marker. ZIP README documents the shared Beijing timezone.
func exportTime(value time.Time) string {
	return value.In(exportLocation).Format("2006-01-02 15:04:05.999999999")
}
