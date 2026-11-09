package export

import (
	"encoding/json"
	"testing"
	"time"

	"thcpn-gin/internal/systemsettings"
)

func TestUserExportRangeUsesSelectedContent(t *testing.T) {
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		name, kind string
		images     bool
		span       time.Duration
		reject     bool
	}{
		{"image boundary", "media_zip", false, 30 * 24 * time.Hour, false},
		{"image exceeds limit", "media_zip", false, 31*24*time.Hour + time.Second, true},
		{"mixed package", "standard_station_zip", true, 32 * 24 * time.Hour, true},
		{"group package without images", "group_site_zip", false, 365 * 24 * time.Hour, false},
		{"carbon exceeds year", "carbon_station_zip", false, 365*24*time.Hour + time.Second, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg, err := json.Marshal(batchExportConfig{StartTime: start, EndTime: start.Add(test.span), IncludeData: true, IncludeImages: test.images})
			if err != nil {
				t.Fatal(err)
			}
			if err = (&Service{}).validateUserExportRange(t.Context(), ResolvedResource{ExportType: test.kind}, cfg); (err != nil) != test.reject {
				t.Fatalf("unexpected range result: %v", err)
			}
		})
	}
	ctx := systemsettings.With(t.Context(), systemsettings.Values{"export_image_days": 10})
	cfg, err := json.Marshal(batchExportConfig{StartTime: start, EndTime: start.Add(11 * 24 * time.Hour), IncludeImages: true})
	if err != nil {
		t.Fatal(err)
	}
	if err = (&Service{}).validateUserExportRange(ctx, ResolvedResource{ExportType: "standard_station_zip"}, cfg); err == nil {
		t.Fatal("configured image limit not applied")
	}
}
